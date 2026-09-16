import { NextResponse, after } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { cleanupOldJobs, createJob, getJob, getJobWorkDir } from "@/lib/jobs";
import { runProcessingJob } from "@/lib/pipeline";
import { isVercel } from "@/lib/paths";
import { getResultBuffer } from "@/lib/result-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const formSchema = z.object({
  translationEdition: z.string().default("20"),
});

function publicJob(job: NonNullable<Awaited<ReturnType<typeof getJob>>>) {
  return {
    id: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    error: job.error,
    resultFileName: job.resultFileName,
    resultUrl: job.resultUrl,
    segments: job.segments?.map((s) => ({
      surah: s.surah,
      ayah: s.ayah,
      startSec: s.startSec,
      endSec: s.endSec,
      translation: s.translation,
    })),
    surah: job.surah,
    startAyah: job.startAyah,
    endAyah: job.endAyah,
  };
}

export async function POST(request: Request) {
  try {
    await cleanupOldJobs();

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Audio/video file is required" },
        { status: 400 },
      );
    }

    const parsed = formSchema.safeParse({
      translationEdition: form.get("translationEdition") ?? "20",
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid form fields", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { translationEdition } = parsed.data;

    const allowed = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/m4a",
      "video/mp4",
      "application/octet-stream",
    ];
    const lowerName = file.name.toLowerCase();
    const extOk =
      lowerName.endsWith(".mp3") ||
      lowerName.endsWith(".mp4") ||
      lowerName.endsWith(".wav") ||
      lowerName.endsWith(".m4a") ||
      lowerName.endsWith(".aac") ||
      lowerName.endsWith(".caf") ||
      lowerName.endsWith(".mov");

    if (!extOk && !allowed.includes(file.type) && file.type !== "") {
      return NextResponse.json(
        { error: "Only MP3, MP4, WAV, or M4A uploads are supported" },
        { status: 400 },
      );
    }

    const maxBytes = isVercel() ? 25 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        {
          error: isVercel()
            ? "For online demo, please use a file smaller than 25 MB (short recitation)."
            : "That file is too large. Please use a file smaller than 100 MB.",
        },
        { status: 400 },
      );
    }

    const jobId = randomUUID();
    const workDir = getJobWorkDir(jobId);
    await fs.mkdir(workDir, { recursive: true });

    const ext = path.extname(file.name) || ".mp3";
    const sourcePath = path.join(workDir, `upload${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(sourcePath, buffer);

    const job = await createJob({
      id: jobId,
      surah: 0,
      startAyah: 0,
      endAyah: 0,
      translationEdition,
    });

    if (isVercel()) {
      await runProcessingJob(jobId, sourcePath);
      const finished = await getJob(jobId);
      const stored = getResultBuffer(jobId);

      // Include small audio inline so preview/download works across serverless instances
      let audioBase64: string | undefined;
      if (stored && stored.buffer.byteLength <= 3_500_000) {
        audioBase64 = stored.buffer.toString("base64");
      }

      return NextResponse.json({
        jobId: job.id,
        mode: "sync",
        job: finished ? publicJob(finished) : null,
        audioBase64,
      });
    }

    after(() => runProcessingJob(jobId, sourcePath));
    return NextResponse.json({ jobId: job.id, mode: "async" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
