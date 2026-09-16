import { promises as fs } from "fs";
import path from "path";
import type { SurahMeta } from "./types";
import { getQuranCacheRoot } from "./paths";

const BASE = "https://api.quran.com/api/v4";

function cacheDir() {
  return getQuranCacheRoot();
}

/** Quran.com translation resource IDs */
export const TRANSLATIONS = {
  sahih: "20",
  pickthall: "19",
  hilali: "203",
  yusufali: "22",
} as const;

export interface AyahContent {
  surah: number;
  ayah: number;
  arabic: string;
  translation: string;
}

async function ensureCacheDir() {
  await fs.mkdir(cacheDir(), { recursive: true });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) {
    throw new Error(`Quran.com API request failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

/** Strip footnote markup Quran.com embeds in translation HTML. */
export function cleanTranslationText(raw: string): string {
  return raw
    .replace(/<sup\b[^>]*>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listSurahs(): Promise<SurahMeta[]> {
  const cachePath = path.join(cacheDir(), "surahs.json");
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return JSON.parse(cached) as SurahMeta[];
  } catch {
    // cache miss
  }

  const data = await fetchJson<{
    chapters: Array<{
      id: number;
      name_arabic: string;
      name_simple: string;
      verses_count: number;
      revelation_place: string;
      translated_name?: { name: string };
    }>;
  }>(`${BASE}/chapters`);

  const surahs: SurahMeta[] = data.chapters.map((c) => ({
    number: c.id,
    name: c.name_arabic,
    englishName: c.name_simple,
    englishNameTranslation: c.translated_name?.name ?? c.name_simple,
    numberOfAyahs: c.verses_count,
    revelationType: c.revelation_place,
  }));

  await ensureCacheDir();
  await fs.writeFile(cachePath, JSON.stringify(surahs, null, 2), "utf8");
  return surahs;
}

export async function getAyahRange(
  surah: number,
  startAyah: number,
  endAyah: number,
  translationId: string = TRANSLATIONS.sahih,
): Promise<AyahContent[]> {
  if (startAyah < 1 || endAyah < startAyah) {
    throw new Error("Invalid ayah range");
  }

  const cacheKey = `surah-${surah}-tr${translationId}.json`;
  const cachePath = path.join(cacheDir(), cacheKey);

  type CachedAyah = {
    numberInSurah: number;
    arabic: string;
    translation: string;
  };

  let ayahs: CachedAyah[] | null = null;

  try {
    const cached = await fs.readFile(cachePath, "utf8");
    ayahs = JSON.parse(cached) as CachedAyah[];
  } catch {
    ayahs = null;
  }

  if (!ayahs) {
    const collected: CachedAyah[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url =
        `${BASE}/verses/by_chapter/${surah}` +
        `?translations=${encodeURIComponent(translationId)}` +
        `&fields=text_uthmani&per_page=300&page=${page}`;

      const data = await fetchJson<{
        verses: Array<{
          verse_number: number;
          text_uthmani?: string;
          translations?: Array<{ text: string }>;
        }>;
        pagination: {
          current_page: number;
          total_pages: number;
        };
      }>(url);

      for (const v of data.verses) {
        collected.push({
          numberInSurah: v.verse_number,
          arabic: v.text_uthmani ?? "",
          translation: cleanTranslationText(v.translations?.[0]?.text ?? ""),
        });
      }

      totalPages = data.pagination.total_pages;
      page += 1;
    } while (page <= totalPages);

    ayahs = collected.sort((a, b) => a.numberInSurah - b.numberInSurah);
    await ensureCacheDir();
    await fs.writeFile(cachePath, JSON.stringify(ayahs, null, 2), "utf8");
  }

  return ayahs
    .filter((a) => a.numberInSurah >= startAyah && a.numberInSurah <= endAyah)
    .map((a) => ({
      surah,
      ayah: a.numberInSurah,
      arabic: a.arabic,
      translation: a.translation,
    }));
}
