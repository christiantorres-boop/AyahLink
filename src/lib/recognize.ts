import OpenAI from "openai";
import { toFile } from "openai";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { getAyahRange, listSurahs } from "./quran-com";
import { getQuranCacheRoot } from "./paths";

export interface RecognizedRange {
  surah: number;
  startAyah: number;
  endAyah: number;
  surahName: string;
  confidence: number;
  method: "whisper";
}

type CatalogAyah = {
  surah: number;
  ayah: number;
  arabic: string;
  tokens: string[];
};

function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function normalizeArabic(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[^\u0621-\u063A\u0641-\u064A\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeArabic(text).split(" ").filter(Boolean);
}

function overlapRatio(a: string[], b: Set<string>): number {
  if (a.length === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) {
    if (b.has(t)) hit += 1;
  }
  return hit / a.length;
}

async function loadCatalog(): Promise<CatalogAyah[]> {
  const cachePath = path.join(getQuranCacheRoot(), "all-ayahs-uthmani.json");
  try {
    const cached = await fsp.readFile(cachePath, "utf8");
    const parsed = JSON.parse(cached) as Array<{
      surah: number;
      ayah: number;
      arabic: string;
    }>;
    return parsed.map((a) => ({
      ...a,
      tokens: tokenize(a.arabic),
    }));
  } catch {
    // cache miss
  }

  const res = await fetch("https://api.quran.com/api/v4/quran/verses/uthmani", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Could not load Qur'an text for recognition (${res.status})`);
  }

  const data = (await res.json()) as {
    verses: Array<{ verse_key: string; text_uthmani: string }>;
  };

  const compact = data.verses.map((v) => {
    const [surahRaw, ayahRaw] = v.verse_key.split(":");
    return {
      surah: Number(surahRaw),
      ayah: Number(ayahRaw),
      arabic: v.text_uthmani,
    };
  });

  await fsp.mkdir(getQuranCacheRoot(), { recursive: true });
  await fsp.writeFile(cachePath, JSON.stringify(compact), "utf8");

  return compact.map((a) => ({
    ...a,
    tokens: tokenize(a.arabic),
  }));
}

async function whisperTranscript(wavPath: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = await toFile(fs.createReadStream(wavPath), "recitation.wav");

  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "ar",
    response_format: "text",
  });

  return typeof result === "string" ? result : String(result);
}

function findBestRange(
  catalog: CatalogAyah[],
  transcriptTokens: string[],
): { start: number; end: number; score: number } | null {
  if (transcriptTokens.length < 2) return null;

  const transcriptSet = new Set(transcriptTokens);
  const maxLen = Math.min(40, Math.max(3, Math.ceil(transcriptTokens.length / 3)));

  let best: { start: number; end: number; score: number } | null = null;

  for (let len = 1; len <= maxLen; len++) {
    for (let i = 0; i <= catalog.length - len; i++) {
      // Prefer contiguous verses in one Surah (normal for one recording)
      const first = catalog[i];
      const last = catalog[i + len - 1];
      if (first.surah !== last.surah) continue;

      const rangeTokens: string[] = [];
      for (let j = i; j < i + len; j++) {
        rangeTokens.push(...catalog[j].tokens);
      }
      if (rangeTokens.length === 0) continue;

      const coverage = overlapRatio(rangeTokens, transcriptSet);
      const reverseCoverage = overlapRatio(transcriptTokens, new Set(rangeTokens));
      // Blend: how much of the ayah text appears in speech, and how much speech matches ayahs
      const score = coverage * 0.55 + reverseCoverage * 0.45 + Math.min(len, 12) * 0.01;

      if (!best || score > best.score) {
        best = { start: i, end: i + len - 1, score };
      }
    }
  }

  return best;
}

/**
 * Listen to the recording and detect which Surah + ayah range is recited.
 * Requires OPENAI_API_KEY (Whisper).
 */
export async function recognizeRecitation(
  wavPath: string,
): Promise<RecognizedRange> {
  if (!hasOpenAI()) {
    throw new Error(
      "Auto verse detection needs an OpenAI API key (Whisper). Add OPENAI_API_KEY in Vercel env vars.",
    );
  }

  const [catalog, transcript, surahs] = await Promise.all([
    loadCatalog(),
    whisperTranscript(wavPath),
    listSurahs(),
  ]);

  const tokens = tokenize(transcript);
  if (tokens.length < 3) {
    throw new Error(
      "Could not hear clear Arabic in that recording. Please use a clearer, shorter recitation.",
    );
  }

  const best = findBestRange(catalog, tokens);
  if (!best || best.score < 0.28) {
    throw new Error(
      "Could not recognize which Surah and verses are in this recording. Try a clearer clip of one Surah only.",
    );
  }

  const startAyah = catalog[best.start];
  const endAyah = catalog[best.end];
  const meta = surahs.find((s) => s.number === startAyah.surah);

  // Sanity: ensure we can load translations for this range
  await getAyahRange(startAyah.surah, startAyah.ayah, endAyah.ayah, "20");

  return {
    surah: startAyah.surah,
    startAyah: startAyah.ayah,
    endAyah: endAyah.ayah,
    surahName: meta?.englishName ?? `Surah ${startAyah.surah}`,
    confidence: Number(best.score.toFixed(3)),
    method: "whisper",
  };
}
