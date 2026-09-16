import type { ProcessJob } from "./types";

type StoredResult = {
  buffer: Buffer;
  fileName: string;
  job: ProcessJob;
  savedAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __ayahlinkResults?: Map<string, StoredResult>;
};

function store() {
  if (!globalStore.__ayahlinkResults) {
    globalStore.__ayahlinkResults = new Map();
  }
  return globalStore.__ayahlinkResults;
}

export function saveResultBuffer(
  jobId: string,
  buffer: Buffer,
  fileName: string,
  job: ProcessJob,
) {
  store().set(jobId, {
    buffer,
    fileName,
    job,
    savedAt: Date.now(),
  });
}

export function getResultBuffer(jobId: string): StoredResult | null {
  const item = store().get(jobId);
  if (!item) return null;
  // Expire after 2 hours
  if (Date.now() - item.savedAt > 1000 * 60 * 60 * 2) {
    store().delete(jobId);
    return null;
  }
  return item;
}

export function getStoredJob(jobId: string): ProcessJob | null {
  return getResultBuffer(jobId)?.job ?? null;
}
