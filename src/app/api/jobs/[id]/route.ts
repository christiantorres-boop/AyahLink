import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { getStoredJob } from "@/lib/result-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = (await getJob(id)) ?? getStoredJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    error: job.error,
    resultFileName: job.resultFileName,
    resultUrl: job.resultUrl,
    surah: job.surah,
    startAyah: job.startAyah,
    endAyah: job.endAyah,
    segments: job.segments?.map((s) => ({
      surah: s.surah,
      ayah: s.ayah,
      startSec: s.startSec,
      endSec: s.endSec,
      translation: s.translation,
    })),
  });
}
