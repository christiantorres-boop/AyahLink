import { put, list } from "@vercel/blob";
import type { ProcessJob } from "./types";

export function hasBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function saveJobBlob(job: ProcessJob): Promise<string | null> {
  if (!hasBlobStore()) return null;
  const blob = await put(`ayahlink/jobs/${job.id}.json`, JSON.stringify(job), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return blob.url;
}

export async function saveAudioBlob(
  jobId: string,
  buffer: Buffer,
  fileName: string,
): Promise<string | null> {
  if (!hasBlobStore()) return null;
  const blob = await put(`ayahlink/results/${jobId}.mp3`, buffer, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "audio/mpeg",
  });
  void fileName;
  return blob.url;
}

export async function loadJobBlob(jobId: string): Promise<ProcessJob | null> {
  if (!hasBlobStore()) return null;
  try {
    const listed = await list({ prefix: `ayahlink/jobs/${jobId}`, limit: 10 });
    const match = listed.blobs.find((b) => b.pathname.endsWith(`${jobId}.json`));
    if (!match) return null;
    const res = await fetch(match.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ProcessJob;
  } catch {
    return null;
  }
}
