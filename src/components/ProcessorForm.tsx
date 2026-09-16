"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SurahMeta } from "@/lib/types";
import { ProgressModal } from "@/components/ProgressModal";

type JobView = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  step: string;
  progress: number;
  message: string;
  error?: string;
  resultFileName?: string;
  resultUrl?: string;
  audioUrl?: string;
  segments?: Array<{
    surah: number;
    ayah: number;
    startSec: number;
    endSec: number;
    translation: string;
  }>;
};

const EDITIONS = [
  { id: "20", label: "Saheeh International (easiest to understand)" },
  { id: "19", label: "Pickthall" },
  { id: "203", label: "Hilali & Khan" },
  { id: "22", label: "Yusuf Ali" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function friendlyError(raw: string) {
  const lower = raw.toLowerCase();
  if (
    lower.includes("did not match the expected pattern") ||
    lower.includes("pattern")
  ) {
    return "Please type verse numbers as normal numbers (example: 6, not 06), and use an MP3 or M4A recording.";
  }
  if (lower.includes("openai") || lower.includes("api key")) {
    return "Something went wrong with the voice service. Please try again in a minute.";
  }
  if (lower.includes("ffprobe") || lower.includes("ffmpeg")) {
    return "Audio tools are still starting. Please wait a moment and try again.";
  }
  if (lower.includes("file")) {
    return "We could not read that file. Please try an MP3 or M4A under 25 MB.";
  }
  if (lower.includes("job not found")) {
    return "The server finished, but this phone lost the job link. Please try once more.";
  }
  return raw.length > 140
    ? "Something went wrong. Please check your file and verse numbers, then try again."
    : raw;
}

function audioUrlFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

function resolveAudioUrl(job: JobView) {
  return job.audioUrl || job.resultUrl || `/api/download/${job.id}?preview=1`;
}

function resolveDownloadUrl(job: JobView) {
  return job.audioUrl || job.resultUrl || `/api/download/${job.id}`;
}

function parseVerseNumber(raw: string, fallback: number) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return fallback;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function ProcessorForm() {
  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
  const [surah, setSurah] = useState(1);
  const [startAyah, setStartAyah] = useState(1);
  const [endAyah, setEndAyah] = useState(7);
  const [edition, setEdition] = useState("20");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/surahs");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load Surah list");
        if (!cancelled) setSurahs(data.surahs);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? friendlyError(err.message)
              : "Could not load Surah list. Check your internet and refresh.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSurah = useMemo(
    () => surahs.find((s) => s.number === surah),
    [surahs, surah],
  );

  const maxAyah = selectedSurah?.numberOfAyahs ?? 286;
  const ayahCount = Math.max(0, endAyah - startAyah + 1);

  useEffect(() => {
    setStartAyah(1);
    setEndAyah(Math.min(7, maxAyah));
  }, [surah, maxAyah]);

  useEffect(() => {
    if (!job || job.id !== "pending") return;
    const timer = setInterval(() => {
      setJob((prev) => {
        if (!prev || prev.id !== "pending") return prev;
        const next = Math.min(88, prev.progress + 2);
        return {
          ...prev,
          progress: next,
          message:
            next < 30
              ? "Uploading your file..."
              : next < 60
                ? "Processing your recording (this can take a few minutes)..."
                : "Still working - creating Arabic + English audio...",
        };
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (!job || job.id === "pending") return;
    if (job.status === "completed" || job.status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not check progress");
        setJob(data);
        if (data.status === "completed" || data.status === "failed") {
          setBusy(false);
          if (data.status === "completed") {
            setTimeout(() => {
              resultRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }, 400);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? friendlyError(err.message)
            : "Lost connection while working. Please try again.",
        );
        setBusy(false);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [job]);

  function pickFile(next: File | null) {
    if (!next) return;
    const name = next.name.toLowerCase();
    const type = (next.type || "").toLowerCase();
    const okExt =
      name.endsWith(".mp3") ||
      name.endsWith(".mp4") ||
      name.endsWith(".wav") ||
      name.endsWith(".m4a") ||
      name.endsWith(".aac") ||
      name.endsWith(".caf") ||
      name.endsWith(".mov") ||
      name.endsWith(".mpeg") ||
      name.endsWith(".mpg");
    const okType =
      type.startsWith("audio/") ||
      type.startsWith("video/") ||
      type === "application/octet-stream" ||
      type === "";
    if (!okExt && !okType) {
      setError("Please choose an audio/video recording (MP3, M4A, WAV, or MP4).");
      return;
    }
    if (next.size > 25 * 1024 * 1024) {
      setError(
        "Please use a shorter recording under 25 MB for the online demo (best: one short Surah).",
      );
      return;
    }
    setError(null);
    setFile(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const start = Math.max(1, Math.min(maxAyah, Number(startAyah) || 1));
    const end = Math.max(1, Math.min(maxAyah, Number(endAyah) || start));
    setStartAyah(start);
    setEndAyah(end);

    if (!file) {
      setError("Step 1 is missing: please choose your recording first.");
      fileInputRef.current?.focus();
      return;
    }
    if (end < start) {
      setError(
        "The ending verse number must be the same as or after the starting verse.",
      );
      return;
    }

    setBusy(true);
    setJob({
      id: "pending",
      status: "processing",
      step: "uploading",
      progress: 8,
      message: "Uploading your file and starting work...",
    });
    setStartedAt(Date.now());
    setModalOpen(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("surah", String(surah));
      body.append("startAyah", String(start));
      body.append("endAyah", String(end));
      body.append("translationEdition", edition);

      const res = await fetch("/api/process", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start. Please try again.");

      // Vercel runs the job in this same request and returns the finished job
      if (data.mode === "sync" && data.job) {
        const finished = data.job as JobView;
        if (data.audioBase64 && typeof data.audioBase64 === "string") {
          finished.audioUrl = audioUrlFromBase64(data.audioBase64);
        }
        setJob(finished);
        setBusy(false);
        if (finished.status === "completed") {
          setTimeout(() => {
            resultRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 400);
        }
        return;
      }

      // Local/async: poll job status
      const statusRes = await fetch(`/api/jobs/${data.jobId}`);
      const statusData = await statusRes.json();
      if (statusRes.ok) {
        setJob(statusData);
        if (statusData.status === "completed" || statusData.status === "failed") {
          setBusy(false);
        }
      } else {
        setJob({
          id: data.jobId,
          status: "queued",
          step: "uploading",
          progress: 5,
          message: "We received your file...",
        });
      }
    } catch (err) {
      setBusy(false);
      setModalOpen(false);
      setStartedAt(null);
      setJob(null);
      setError(
        err instanceof Error
          ? friendlyError(err.message)
          : "Upload failed. Please try again.",
      );
    }
  }

  function resetJob() {
    setJob(null);
    setError(null);
    setModalOpen(false);
    setStartedAt(null);
    setBusy(false);
  }

  return (
    <section id="start" className="workspace" aria-labelledby="workspace-title">
      <div className="workspace-head">
        <p className="eyebrow">Let’s make your file</p>
        <h2 id="workspace-title">Follow the steps below</h2>
        <p>
          Fill each box. When you are done, tap the big green button. We will do
          the hard work for you.
        </p>
      </div>

      <form className="processor" onSubmit={onSubmit} noValidate>
        <fieldset className="step-card" disabled={busy}>
          <legend>
            <span className="badge">Step 1</span>
            Upload your Qur’an recording
          </legend>
          <p className="hint">
            This is the audio or video where someone is reciting in Arabic.
            Phone recordings are fine.
          </p>

          <div
            className={`dropzone ${dragOver ? "is-over" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Choose a recording file"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.mp3,.mp4,.m4a,.wav,.aac,.caf,.mov"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <strong className="drop-title">File ready</strong>
                <span className="drop-file">{file.name}</span>
                <span className="drop-meta">
                  {formatBytes(file.size)} · tap to change
                </span>
              </>
            ) : (
              <>
                <strong className="drop-title">Tap here to choose a file</strong>
                <span className="drop-meta">
                  or drag and drop · MP3 / MP4 / WAV / M4A
                </span>
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="step-card" disabled={busy}>
          <legend>
            <span className="badge">Step 2</span>
            Which verses are in this recording?
          </legend>
          <p className="hint">
            Match what is actually recited in your file. Example: if the file is
            all of Al-Fatihah, choose Surah 1, verses 1 to 7.
          </p>

          <label className="field">
            <span>Surah (chapter)</span>
            <select
              value={surah}
              onChange={(e) => setSurah(Number(e.target.value))}
              disabled={!surahs.length}
              aria-describedby="surah-help"
            >
              {!surahs.length ? (
                <option>Loading Surah list…</option>
              ) : (
                surahs.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.number}. {s.englishName} - {s.numberOfAyahs} verses
                  </option>
                ))
              )}
            </select>
            <small id="surah-help" className="field-help">
              {selectedSurah
                ? `${selectedSurah.englishName} has ${selectedSurah.numberOfAyahs} verses total.`
                : "Loading…"}
            </small>
          </label>

          <div className="grid-2">
            <label className="field">
              <span>First verse number</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={String(startAyah)}
                onChange={(e) =>
                  setStartAyah(parseVerseNumber(e.target.value, startAyah))
                }
              />
            </label>
            <label className="field">
              <span>Last verse number</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={String(endAyah)}
                onChange={(e) =>
                  setEndAyah(parseVerseNumber(e.target.value, endAyah))
                }
              />
            </label>
          </div>

          <p className="summary-chip" aria-live="polite">
            You selected <strong>{ayahCount}</strong> verse
            {ayahCount === 1 ? "" : "s"}
            {selectedSurah
              ? ` from ${selectedSurah.englishName} (${startAyah}-${endAyah})`
              : ""}
            .
          </p>
        </fieldset>

        <fieldset className="step-card" disabled={busy}>
          <legend>
            <span className="badge">Step 3</span>
            Which English translation?
          </legend>
          <p className="hint">
            If you are not sure, keep the first option. It is clear and widely
            used.
          </p>
          <label className="field">
            <span>English style</span>
            <select value={edition} onChange={(e) => setEdition(e.target.value)}>
              {EDITIONS.map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <div className="step-card action-card">
          <p className="badge-inline">
            <span className="badge">Step 4</span> Create your file
          </p>
          <p className="hint tight">
            This can take a few minutes for longer recordings. Keep this page
            open.
          </p>
          <button
            className="primary-btn full"
            type="submit"
            disabled={busy || !surahs.length}
          >
            {busy ? "Please wait - working..." : "Create my Arabic + English audio"}
          </button>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <ProgressModal
        open={modalOpen}
        job={job}
        audioSrc={job ? resolveAudioUrl(job) : undefined}
        downloadHref={job ? resolveDownloadUrl(job) : undefined}
        startedAt={startedAt}
        ayahCount={ayahCount}
        surahLabel={selectedSurah?.englishName ?? `Surah ${surah}`}
        onCloseSuccess={() => setModalOpen(false)}
        onRetry={resetJob}
      />

      {job?.status === "completed" && !modalOpen ? (
        <div className="job-panel" ref={resultRef} aria-live="polite">
          <div className="success-box">
            <h3>Your file is ready</h3>
            <p>
              Listen first. You should hear Arabic, then English, then the next
              verse.
            </p>
            <audio
              className="preview-audio"
              controls
              preload="metadata"
              src={resolveAudioUrl(job)}
            >
              Your browser cannot play audio preview.
            </audio>
            <a className="download-btn full" href={resolveDownloadUrl(job)}>
              Download my audio
            </a>
            <button
              type="button"
              className="ghost-dark"
              onClick={() => setModalOpen(true)}
            >
              Show progress details again
            </button>
          </div>

          {job.segments?.length ? (
            <details className="verse-details">
              <summary>
                See the English verses we used ({job.segments.length})
              </summary>
              <ol className="segment-list">
                {job.segments.map((s) => (
                  <li key={`${s.surah}:${s.ayah}`}>
                    <strong>Verse {s.ayah}</strong>
                    <p>{s.translation}</p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}

      {job?.status === "failed" && !modalOpen ? (
        <div className="job-panel" ref={resultRef}>
          <div className="fail-box">
            <h3>We could not finish</h3>
            <p>
              {friendlyError(
                job.error || "Please try again with a clearer recording.",
              )}
            </p>
            <button type="button" className="ghost-dark" onClick={resetJob}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
