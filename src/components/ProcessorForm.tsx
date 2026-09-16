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
  surah?: number;
  startAyah?: number;
  endAyah?: number;
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
  if (lower.includes("openai") || lower.includes("api key")) {
    return "Verse recognition needs an OpenAI API key on the server. Please ask the site owner to add OPENAI_API_KEY.";
  }
  if (lower.includes("recognize") || lower.includes("could not hear")) {
    return raw.length > 160
      ? "We could not tell which verses are in that recording. Try a clearer, shorter clip of one Surah."
      : raw;
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
    ? "Something went wrong. Please try a clearer short recording and try again."
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

export function ProcessorForm() {
  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
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
      } catch {
        // Surah names are only used for display after detection
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const detectedSurah = useMemo(() => {
    const num = job?.surah || job?.segments?.[0]?.surah;
    if (!num) return null;
    return surahs.find((s) => s.number === num) ?? null;
  }, [job, surahs]);

  const ayahCount = useMemo(() => {
    if (job?.segments?.length) return job.segments.length;
    if (job?.startAyah && job?.endAyah) {
      return Math.max(0, job.endAyah - job.startAyah + 1);
    }
    return 0;
  }, [job]);

  const surahLabel = useMemo(() => {
    if (detectedSurah) {
      const range =
        job?.startAyah && job?.endAyah
          ? ` ${job.startAyah}-${job.endAyah}`
          : "";
      return `${detectedSurah.englishName}${range}`;
    }
    if (job?.surah) return `Surah ${job.surah}`;
    return "Detecting…";
  }, [detectedSurah, job]);

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
            next < 25
              ? "Uploading your file..."
              : next < 50
                ? "Recognizing which Surah and verses you recited..."
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

    if (!file) {
      setError("Step 1 is missing: please choose your recording first.");
      fileInputRef.current?.focus();
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
      body.append("translationEdition", edition);

      const res = await fetch("/api/process", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start. Please try again.");

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
        } else if (finished.status === "failed") {
          setError(friendlyError(finished.error || "Could not finish."));
        }
        return;
      }

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
          Upload a recording. We will detect the Surah and verses, then add
          English after each ayah.
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
            Phone recordings are fine. Best results: one clear Surah with short
            pauses between verses.
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
            <span className="badge">Step 3</span> Create your file
          </p>
          <p className="hint tight">
            We will automatically recognize the Surah and verses from your
            recording. Keep this page open.
          </p>
          <button
            className="primary-btn full"
            type="submit"
            disabled={busy}
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
        surahLabel={surahLabel}
        onCloseSuccess={() => setModalOpen(false)}
        onRetry={resetJob}
      />

      {job?.status === "completed" && !modalOpen ? (
        <div className="job-panel" ref={resultRef} aria-live="polite">
          <div className="success-box">
            <h3>Your file is ready</h3>
            <p>
              Detected {surahLabel}. Listen first. You should hear Arabic, then
              English, then the next verse.
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
