import { NextResponse } from "next/server";
import { listSurahs } from "@/lib/quran-com";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const surahs = await listSurahs();
    return NextResponse.json({ surahs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load surahs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
