"use client";

import { useEffect, useMemo, useState } from "react";

export type ProgressJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  step: string;
  progress: number;
  message: string;
  error?: string;
  resultFileName?: string;
  segments?: Array<{
    surah: number;
    ayah: number;
    translation: string;
  }>;
};

const PIPELINE_STEPS: Array<{ id: string; label: string; detail: string }> = [
  {
    id: "uploading",
    label: "Receive your file",
    detail: "Saving your recording safely",
  },
  {
    id: "extracting_audio",
    label: "Read the recording",
    detail: "Opening the audio so we can work with it",
  },
  {
    id: "detecting_ayahs",
    label: "Recognize Surah and verses",
    detail: "Listening to figure out which ayahs you recited",
  },
  {
    id: "fetching_ayahs",
    label: "Get English meanings",
    detail: "Looking up each verse translation",
  },
  {
    id: "generating_tts",
    label: "Create English voice",
    detail: "Turning each translation into spoken audio",
  },
  {
    id: "interleaving",
    label: "Join Arabic + English",
    detail: "Putting the pieces into one file",
  },
  {
    id: "finalizing",
    label: "Finish up",
    detail: "Preparing your download",
  },
];

const STEP_ORDER = PIPELINE_STEPS.map((s) => s.id);

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r} sec`;
  return `${m} min ${r.toString().padStart(2, "0")} sec`;
}

function stepIndex(step: string) {
  const idx = STEP_ORDER.indexOf(step);
  return idx >= 0 ? idx : 0;
}

type Props = {
  open: boolean;
  job: ProgressJob | null;
  audioSrc?: string;
  downloadHref?: string;
  startedAt: number | null;
  ayahCount: number;
  surahLabel: string;
  onCloseSuccess?: () => void;
  onRetry?: () => void;
};

export function ProgressModal({
  open,
  job,
  audioSrc,
  downloadHref,
  startedAt,
  ayahCount,
  surahLabel,
  onCloseSuccess,
  onRetry,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const progress = Math.min(100, Math.max(0, Math.round(job?.progress ?? 0)));
  const currentStep = job?.step ?? "uploading";
  const currentIdx = stepIndex(currentStep);
  const isDone = job?.status === "completed";
  const isFailed = job?.status === "failed";
  const isWorking = open && job && !isDone && !isFailed;

  const elapsedSec = useMemo(() => {
    if (!startedAt) return 0;
    return (now - startedAt) / 1000;
  }, [now, startedAt]);

  const etaSec = useMemo(() => {
    if (isDone) return 0;
    if (progress < 8 || elapsedSec < 3) return null;
    const totalEstimate = (elapsedSec / progress) * 100;
    return Math.max(0, totalEstimate - elapsedSec);
  }, [elapsedSec, progress, isDone]);

  if (!open || !job) return null;

  const headline = isDone
    ? "Your file is ready!"
    : isFailed
      ? "We could not finish"
      : "Please wait - we are working";

  const statusLine = isDone
    ? "Listen below first. If it sounds good, download it."
    : isFailed
      ? (() => {
          const raw = job.error || "Something went wrong. Please try again.";
          if (/ffprobe|ffmpeg/i.test(raw)) {
            return "Audio tools had a problem. Please tap Try again.";
          }
          if (raw.length > 140) {
            return "Something went wrong. Please try again with a clearer recording.";
          }
          return raw;
        })()
      : job.message || "Working on your audio…";

  const previewUrl = audioSrc || `/api/download/${job.id}?preview=1`;
  const downloadUrl = downloadHref || `/api/download/${job.id}`;

  return (
    <div className="progress-modal-root" role="presentation">
      <div className="progress-modal-backdrop" aria-hidden="true" />
      <div
        className="progress-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-modal-title"
        aria-describedby="progress-modal-desc"
      >
        <div className="progress-modal-scroll">
          <div className="progress-modal-head">
            <p className="progress-kicker">
              {isWorking ? "In progress" : isDone ? "Complete" : "Stopped"}
            </p>
            <h2 id="progress-modal-title">{headline}</h2>
            <p id="progress-modal-desc" className="progress-status">
              {statusLine}
            </p>
            <p className="progress-scroll-hint">
              Tip: scroll inside this white box to see more details.
            </p>
          </div>

          {!isDone ? (
            <>
              <div className="progress-ring-wrap">
                <div
                  className="progress-ring"
                  style={{ ["--p" as string]: `${progress}` }}
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${progress} percent complete`}
                >
                  <div className="progress-ring-inner">
                    <strong>{progress}%</strong>
                    <span>complete</span>
                  </div>
                </div>
              </div>

              <div className="progress-stats">
                <div className="stat">
                  <span className="stat-label">Time used</span>
                  <strong>{formatDuration(elapsedSec)}</strong>
                </div>
                <div className="stat">
                  <span className="stat-label">Est. time left</span>
                  <strong>
                    {isFailed
                      ? "-"
                      : etaSec == null
                        ? "Calculating…"
                        : formatDuration(etaSec)}
                  </strong>
                </div>
                <div className="stat">
                  <span className="stat-label">Verses</span>
                  <strong>
                    {ayahCount} · {surahLabel}
                  </strong>
                </div>
              </div>
            </>
          ) : null}

          {isDone ? (
            <div className="preview-box">
              <h3>Preview (listen first)</h3>
              <p>
                Press play. You should hear Arabic, then English, then the next
                verse.
              </p>
              <audio
                className="preview-audio"
                controls
                preload="metadata"
                src={previewUrl}
              >
                Your browser cannot play audio preview.
              </audio>
            </div>
          ) : null}

          <ol className="progress-checklist">
            {PIPELINE_STEPS.map((step, idx) => {
              let state: "done" | "current" | "todo" = "todo";
              if (isDone || idx < currentIdx) state = "done";
              else if (idx === currentIdx && !isFailed) state = "current";
              else if (isFailed && idx === currentIdx) state = "current";

              return (
                <li key={step.id} className={`check-item is-${state}`}>
                  <span className="check-mark" aria-hidden="true">
                    {state === "done" ? "✓" : state === "current" ? "●" : "○"}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {isWorking ? (
            <p className="progress-foot-note">
              Keep this page open. Do not close or refresh until we finish.
            </p>
          ) : null}
        </div>

        {isDone ? (
          <div className="progress-actions sticky-actions">
            <a className="download-btn full" href={downloadUrl}>
              Download my audio
            </a>
            <button
              type="button"
              className="ghost-dark full"
              onClick={onCloseSuccess}
            >
              Close this window
            </button>
          </div>
        ) : null}

        {isFailed ? (
          <div className="progress-actions sticky-actions">
            <button type="button" className="primary-btn full" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
