import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getJob } from "@/lib/jobs";
import { getResultBuffer } from "@/lib/result-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const preview = new URL(request.url).searchParams.get("preview") === "1";

  const memory = getResultBuffer(id);
  if (memory) {
    return new NextResponse(new Uint8Array(memory.buffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": preview
          ? `inline; filename="${memory.fileName}"`
          : `attachment; filename="${memory.fileName}"`,
        "Content-Length": String(memory.buffer.byteLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const job = await getJob(id);
  if (job?.resultUrl) {
    return NextResponse.redirect(job.resultUrl, 302);
  }

  if (!job || job.status !== "completed" || !job.resultPath) {
    return NextResponse.json({ error: "Result not ready" }, { status: 404 });
  }

  try {
    const data = await fs.readFile(job.resultPath);
    const fileName = job.resultFileName ?? `ayahlink-${id}.mp3`;

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": preview
          ? `inline; filename="${fileName}"`
          : `attachment; filename="${fileName}"`,
        "Content-Length": String(data.byteLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Result file expired. Please create the audio again." },
      { status: 404 },
    );
  }
}
