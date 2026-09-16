import path from "path";
import { promises as fs } from "fs";
import { detectAyahSegments } from "./align";
import { updateJob, getJobWorkDir, getJob } from "./jobs";
import {
  concatMp3Files,
  cutSegment,
  extractAudioToWav,
} from "./media";
import { getAyahRange } from "./quran-com";
import { synthesizeTranslationMp3 } from "./tts";
import { saveResultBuffer } from "./result-store";
import { saveAudioBlob, saveJobBlob } from "./blob-store";

export async function runProcessingJob(
  jobId: string,
  sourceFilePath: string,
): Promise<void> {
  const workDir = getJobWorkDir(jobId);

  try {
    await updateJob(jobId, {
      status: "processing",
      step: "extracting_audio",
      progress: 8,
      message: "Listening to your recording...",
    });

    const wavPath = path.join(workDir, "source.wav");
    await extractAudioToWav(sourceFilePath, wavPath);

    const job = await getJob(jobId);
    if (!job) throw new Error("Job missing during processing");

    await updateJob(jobId, {
      step: "fetching_ayahs",
      progress: 18,
      message: "Looking up the English meanings...",
    });

    const ayahs = await getAyahRange(
      job.surah,
      job.startAyah,
      job.endAyah,
      job.translationEdition,
    );

    if (ayahs.length === 0) {
      throw new Error("No ayahs found for the selected range");
    }

    await updateJob(jobId, {
      step: "detecting_ayahs",
      progress: 30,
      message: "Finding where each verse starts and ends...",
    });

    const { segments } = await detectAyahSegments(wavPath, ayahs);

    await updateJob(jobId, {
      segments,
      progress: 45,
      message: "Creating the English voice for each verse...",
      step: "generating_tts",
    });

    const clipPaths: string[] = [];
    const arabicDir = path.join(workDir, "arabic");
    const englishDir = path.join(workDir, "english");
    await fs.mkdir(arabicDir, { recursive: true });
    await fs.mkdir(englishDir, { recursive: true });

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const arabicClip = path.join(arabicDir, `a-${i + 1}.mp3`);
      const englishClip = path.join(englishDir, `e-${i + 1}.mp3`);

      await cutSegment(wavPath, arabicClip, seg.startSec, seg.endSec);
      await synthesizeTranslationMp3(seg.translation, englishClip);

      clipPaths.push(arabicClip, englishClip);

      const pct = 45 + Math.round(((i + 1) / segments.length) * 40);
      await updateJob(jobId, {
        progress: pct,
        message: `Making English audio for verse ${seg.ayah} (${i + 1} of ${segments.length})...`,
      });
    }

    await updateJob(jobId, {
      step: "interleaving",
      progress: 90,
      message: "Joining Arabic and English into one file...",
    });

    const resultName = `ayahlink-${job.surah}_${job.startAyah}-${job.endAyah}.mp3`;
    const resultPath = path.join(workDir, resultName);
    await concatMp3Files(clipPaths, resultPath);

    const resultBuffer = await fs.readFile(resultPath);
    const resultUrl = await saveAudioBlob(jobId, resultBuffer, resultName);

    const completed = await updateJob(jobId, {
      status: "completed",
      step: "finalizing",
      progress: 100,
      message:
        'Done! Listen for the word "English" before each translation. Tip: use a short clear recitation of only those verses.',
      resultPath,
      resultFileName: resultName,
      resultUrl: resultUrl ?? undefined,
    });

    saveResultBuffer(jobId, resultBuffer, resultName, completed);
    await saveJobBlob(completed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    const failed = await updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: "We could not finish this file",
      error: message,
    });
    await saveJobBlob(failed);
  }
}
