import OpenAI from "openai";
import { toFile } from "openai";
import fs from "fs";
import type { AyahContent } from "./quran-com";
import type { AyahSegment } from "./types";
import { detectSilenceBoundaries, getDurationSeconds } from "./media";

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

function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeArabic(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeArabic(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap += 1;
  }
  return overlap / Math.max(ta.size, tb.size);
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function whisperSegments(wavPath: string): Promise<WhisperSegment[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = await toFile(fs.createReadStream(wavPath), "recitation.wav");

  const result = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "ar",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments =
    (
      result as unknown as {
        segments?: Array<{ start: number; end: number; text: string }>;
      }
    ).segments ?? [];

  return segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

function alignByWhisper(
  ayahs: AyahContent[],
  segments: WhisperSegment[],
  totalDuration: number,
): AyahSegment[] | null {
  if (segments.length === 0) return null;

  const assigned: AyahSegment[] = [];
  let segIndex = 0;

  for (let i = 0; i < ayahs.length; i++) {
    const ayah = ayahs[i];
    if (segIndex >= segments.length) break;

    let bestIdx = segIndex;
    let bestScore = -1;
    const lookAhead = Math.min(segments.length - 1, segIndex + 4);

    for (let j = segIndex; j <= lookAhead; j++) {
      const score = tokenOverlapScore(ayah.arabic, segments[j].text);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    const start = segments[bestIdx].start;
    let end =
      i === ayahs.length - 1
        ? totalDuration
        : segments[Math.min(bestIdx + 1, segments.length - 1)].start;

    let k = bestIdx + 1;
    while (
      k < segments.length &&
      i < ayahs.length - 1 &&
      tokenOverlapScore(ayah.arabic, segments[k].text) >=
        tokenOverlapScore(ayahs[i + 1].arabic, segments[k].text)
    ) {
      end = segments[k].end;
      k += 1;
    }

    if (end <= start) {
      end = Math.min(totalDuration, start + 1);
    }

    assigned.push({
      surah: ayah.surah,
      ayah: ayah.ayah,
      arabic: ayah.arabic,
      translation: ayah.translation,
      startSec: Number(start.toFixed(3)),
      endSec: Number(end.toFixed(3)),
    });

    segIndex = Math.max(bestIdx + 1, k);
  }

  if (assigned.length !== ayahs.length) return null;

  for (let i = 0; i < assigned.length; i++) {
    if (i === 0) assigned[i].startSec = 0;
    else assigned[i].startSec = assigned[i - 1].endSec;
    if (i === assigned.length - 1) assigned[i].endSec = totalDuration;
  }

  return assigned;
}

function alignBySilence(
  ayahs: AyahContent[],
  boundaries: number[],
  totalDuration: number,
): AyahSegment[] | null {
  const interiors = boundaries.filter((t) => t > 0.2 && t < totalDuration - 0.2);
  const neededCuts = ayahs.length - 1;
  if (neededCuts <= 0) return null;
  if (interiors.length < neededCuts) return null;

  const chosen: number[] = [];
  if (interiors.length === neededCuts) {
    chosen.push(...interiors);
  } else {
    for (let i = 1; i <= neededCuts; i++) {
      const ideal = (i * totalDuration) / (neededCuts + 1);
      let best = interiors[0];
      let bestDist = Math.abs(best - ideal);
      for (const t of interiors) {
        const dist = Math.abs(t - ideal);
        if (dist < bestDist && !chosen.some((c) => Math.abs(c - t) < 0.15)) {
          best = t;
          bestDist = dist;
        }
      }
      chosen.push(best);
    }
  }

  const uniqueCuts = [...new Set(chosen.map((n) => Number(n.toFixed(3))))].sort(
    (a, b) => a - b,
  );
  if (uniqueCuts.length !== neededCuts) return null;

  const points = [0, ...uniqueCuts, totalDuration];
  return ayahs.map((ayah, i) => ({
    surah: ayah.surah,
    ayah: ayah.ayah,
    arabic: ayah.arabic,
    translation: ayah.translation,
    startSec: points[i],
    endSec: points[i + 1],
  }));
}

/** Split time by Arabic text length so longer ayahs get more duration. */
function alignByTextLength(
  ayahs: AyahContent[],
  totalDuration: number,
): AyahSegment[] {
  const weights = ayahs.map((a) => Math.max(8, a.arabic.replace(/\s+/g, "").length));
  const sum = weights.reduce((acc, n) => acc + n, 0);
  let cursor = 0;
  return ayahs.map((ayah, i) => {
    const share = (weights[i] / sum) * totalDuration;
    const startSec = Number(cursor.toFixed(3));
    cursor = i === ayahs.length - 1 ? totalDuration : cursor + share;
    return {
      surah: ayah.surah,
      ayah: ayah.ayah,
      arabic: ayah.arabic,
      translation: ayah.translation,
      startSec,
      endSec: Number(cursor.toFixed(3)),
    };
  });
}

async function bestSilenceAlignment(
  wavPath: string,
  ayahs: AyahContent[],
  totalDuration: number,
): Promise<AyahSegment[] | null> {
  const attempts: Array<{ minSilenceSec: number; silenceDb: number }> = [
    { minSilenceSec: 0.25, silenceDb: -30 },
    { minSilenceSec: 0.35, silenceDb: -35 },
    { minSilenceSec: 0.45, silenceDb: -40 },
    { minSilenceSec: 0.2, silenceDb: -25 },
    { minSilenceSec: 0.55, silenceDb: -45 },
  ];

  let best: AyahSegment[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const attempt of attempts) {
    try {
      const boundaries = await detectSilenceBoundaries(
        wavPath,
        attempt.minSilenceSec,
        attempt.silenceDb,
      );
      const interiors = boundaries.filter(
        (t) => t > 0.2 && t < totalDuration - 0.2,
      );
      const needed = ayahs.length - 1;
      const score = Math.abs(interiors.length - needed);
      const aligned = alignBySilence(ayahs, boundaries, totalDuration);
      if (aligned && score < bestScore) {
        best = aligned;
        bestScore = score;
        if (score === 0) break;
      }
    } catch {
      // try next settings
    }
  }

  return best;
}

export async function detectAyahSegments(
  wavPath: string,
  ayahs: AyahContent[],
): Promise<{ segments: AyahSegment[]; method: string }> {
  const totalDuration = await getDurationSeconds(wavPath);
  if (totalDuration <= 0) {
    throw new Error("Could not read audio duration");
  }

  if (ayahs.length === 1) {
    return {
      method: "single-ayah",
      segments: [
        {
          surah: ayahs[0].surah,
          ayah: ayahs[0].ayah,
          arabic: ayahs[0].arabic,
          translation: ayahs[0].translation,
          startSec: 0,
          endSec: totalDuration,
        },
      ],
    };
  }

  // 1) OpenAI Whisper (best when API key is set)
  if (hasOpenAI()) {
    try {
      const whispered = await whisperSegments(wavPath);
      const aligned = alignByWhisper(ayahs, whispered, totalDuration);
      if (aligned) {
        return { method: "whisper", segments: aligned };
      }
    } catch (err) {
      console.warn("Whisper alignment failed, falling back:", err);
    }
  }

  // 2) Pause/silence detection (free)
  const silenceAligned = await bestSilenceAlignment(wavPath, ayahs, totalDuration);
  if (silenceAligned) {
    return { method: "silence", segments: silenceAligned };
  }

  // 3) Length-weighted split (free fallback)
  return {
    method: "text-length",
    segments: alignByTextLength(ayahs, totalDuration),
  };
}
