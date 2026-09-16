import path from "path";
import os from "os";

/** On Vercel the app filesystem is read-only except /tmp. */
export function isVercel(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export function getCacheRoot(): string {
  if (isVercel()) {
    return path.join(os.tmpdir(), "ayahlink");
  }
  return path.join(process.cwd(), ".cache");
}

export function getJobsRoot(): string {
  return path.join(getCacheRoot(), "jobs");
}

export function getQuranCacheRoot(): string {
  return path.join(getCacheRoot(), "quran-com");
}
