import { NextResponse, after } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { cleanupOldJobs, createJob, getJobWorkDir } from "@/lib/jobs";
import { runProcessingJob } from "@/lib/pipeline";
import { isVercel } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const formSchema = z.object({
  surah: z.coerce.number().int().min(1).max(114),
  startAyah: z.coerce.number().int().min(1),
  endAyah: z.coerce.number().int().min(1),
  translationEdition: z.string().default("20"),
});

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
      surah: form.get("surah"),
      startAyah: form.get("startAyah"),
      endAyah: form.get("endAyah"),
      translationEdition: form.get("translationEdition") ?? "20",
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid form fields", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { surah, startAyah, endAyah, translationEdition } = parsed.data;
    if (endAyah < startAyah) {
      return NextResponse.json(
        { error: "endAyah must be greater than or equal to startAyah" },
        { status: 400 },
      );
    }

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
      lowerName.endsWith(".m4a");

    if (!extOk && !allowed.includes(file.type)) {
      return NextResponse.json(
        { error: "Only MP3, MP4, WAV, or M4A uploads are supported" },
        { status: 400 },
      );
    }

    // Keep cloud demos short so Vercel can finish within time limits
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
      surah,
      startAyah,
      endAyah,
      translationEdition,
    });

    if (isVercel()) {
      // Serverless: must finish in this request or files are lost
      await runProcessingJob(jobId, sourcePath);
      return NextResponse.json({ jobId: job.id, mode: "sync" });
    }

    // Local/dev: process in background and let the UI poll
    after(() => runProcessingJob(jobId, sourcePath));
    return NextResponse.json({ jobId: job.id, mode: "async" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
