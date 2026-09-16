export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobStep =
  | "uploading"
  | "extracting_audio"
  | "fetching_ayahs"
  | "detecting_ayahs"
  | "generating_tts"
  | "interleaving"
  | "finalizing";

export interface AyahSegment {
  surah: number;
  ayah: number;
  arabic: string;
  translation: string;
  startSec: number;
  endSec: number;
}

export interface ProcessJob {
  id: string;
  status: JobStatus;
  step: JobStep;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  resultPath?: string;
  resultFileName?: string;
  segments?: AyahSegment[];
  surah: number;
  startAyah: number;
  endAyah: number;
  translationEdition: string;
}

export interface SurahMeta {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}
