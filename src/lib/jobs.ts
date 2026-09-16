import { promises as fs } from "fs";
import path from "path";
import type { ProcessJob } from "./types";
import { getJobsRoot } from "./paths";
import { getStoredJob } from "./result-store";

const jobs = new Map<string, ProcessJob>();

function jobsDir() {
  return getJobsRoot();
}

async function ensureJobsDir() {
  await fs.mkdir(jobsDir(), { recursive: true });
}

function jobMetaPath(id: string) {
  return path.join(jobsDir(), `${id}.json`);
}

export function getJobWorkDir(id: string) {
  return path.join(jobsDir(), id);
}

export async function createJob(
  partial: Omit<
    ProcessJob,
    "status" | "step" | "progress" | "message" | "createdAt" | "updatedAt"
  >,
): Promise<ProcessJob> {
  const now = Date.now();
  const job: ProcessJob = {
    ...partial,
    status: "queued",
    step: "uploading",
    progress: 0,
    message: "Queued for processing",
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(job.id, job);
  await ensureJobsDir();
  await fs.mkdir(getJobWorkDir(job.id), { recursive: true });
  await fs.writeFile(jobMetaPath(job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function updateJob(
  id: string,
  patch: Partial<ProcessJob>,
): Promise<ProcessJob> {
  const current = await getJob(id);
  if (!current) {
    throw new Error(`Job not found: ${id}`);
  }

  const next: ProcessJob = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };

  jobs.set(id, next);
  await ensureJobsDir();
  await fs.writeFile(jobMetaPath(id), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function getJob(id: string): Promise<ProcessJob | null> {
  const cached = jobs.get(id);
  if (cached) return cached;

  const fromMemory = getStoredJob(id);
  if (fromMemory) {
    jobs.set(id, fromMemory);
    return fromMemory;
  }

  try {
    const raw = await fs.readFile(jobMetaPath(id), "utf8");
    const job = JSON.parse(raw) as ProcessJob;
    jobs.set(id, job);
    return job;
  } catch {
    return null;
  }
}

export async function cleanupOldJobs(maxAgeMs = 1000 * 60 * 60 * 6) {
  try {
    await ensureJobsDir();
    const entries = await fs.readdir(jobsDir(), { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const id = entry.name.replace(/\.json$/, "");
      const job = await getJob(id);
      if (!job) continue;
      if (now - job.createdAt > maxAgeMs) {
        jobs.delete(id);
        await fs.rm(jobMetaPath(id), { force: true });
        await fs.rm(getJobWorkDir(id), { recursive: true, force: true });
      }
    }
  } catch {
    // ignore cleanup errors on cold starts
  }
}
