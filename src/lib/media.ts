import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { promises as fs } from "fs";
import path from "path";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not found");
}

if (!ffprobe?.path) {
  throw new Error("ffprobe-static binary not found");
}

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobe.path);

function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export async function extractAudioToWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg(
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .output(outputPath),
  );
}

export async function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Number(data.format.duration ?? 0));
    });
  });
}

export async function cutSegment(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
): Promise<void> {
  const duration = Math.max(0.05, endSec - startSec);
  await runFfmpeg(
    ffmpeg(inputPath)
      .setStartTime(startSec)
      .setDuration(duration)
      .audioCodec("libmp3lame")
      .audioBitrate("192k")
      .output(outputPath),
  );
}

export async function concatMp3Files(
  filePaths: string[],
  outputPath: string,
): Promise<void> {
  if (filePaths.length === 0) {
    throw new Error("No audio segments to concatenate");
  }

  const listPath = path.join(path.dirname(outputPath), "concat-list.txt");
  const listBody = filePaths
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(listPath, listBody, "utf8");

  await runFfmpeg(
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .audioCodec("libmp3lame")
      .audioBitrate("192k")
      .output(outputPath),
  );
}

export async function detectSilenceBoundaries(
  wavPath: string,
  minSilenceSec = 0.35,
  silenceDb = -35,
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const boundaries: number[] = [0];
    let stderr = "";

    ffmpeg(wavPath)
      .audioFilters(
        `silencedetect=noise=${silenceDb}dB:d=${minSilenceSec}`,
      )
      .format("null")
      .output("-")
      .on("stderr", (line: string) => {
        stderr += `${line}\n`;
      })
      .on("end", async () => {
        try {
          const duration = await getDurationSeconds(wavPath);
          const silenceEnds = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map(
            (m) => Number(m[1]),
          );
          for (const t of silenceEnds) {
            if (t > 0.2 && t < duration - 0.2) {
              boundaries.push(t);
            }
          }
          boundaries.push(duration);
          const unique = [...new Set(boundaries.map((n) => Number(n.toFixed(3))))]
            .sort((a, b) => a - b);
          resolve(unique);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", (err: Error) => reject(err))
      .run();
  });
}
