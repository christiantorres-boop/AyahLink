import { Communicate } from "edge-tts-universal";
import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const EDGE_VOICE = process.env.EDGE_TTS_VOICE || "en-US-GuyNeural";
const OPENAI_VOICE =
  (process.env.OPENAI_TTS_VOICE as
    | "alloy"
    | "echo"
    | "fable"
    | "onyx"
    | "nova"
    | "shimmer"
    | undefined) || "onyx";

/** Prefer free Edge TTS. Set TTS_PROVIDER=openai to try OpenAI first. */
function preferOpenAI(): boolean {
  return (
    process.env.TTS_PROVIDER === "openai" &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    command.on("end", () => resolve()).on("error", (err: Error) => reject(err)).run();
  });
}

/** Make English louder and add a short pause so it is easy to notice. */
async function boostEnglishClip(inputPath: string, outputPath: string) {
  const tmp = `${outputPath}.boost.mp3`;
  await runFfmpeg(
    ffmpeg(inputPath)
      .audioFilters([
        "silenceremove=start_periods=1:start_silence=0.1:start_threshold=-50dB",
        "volume=3.0",
        "afade=t=in:st=0:d=0.05",
      ])
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .output(tmp),
  );

  // Prepend ~0.4s silence so English does not get lost in the Arabic fade
  await runFfmpeg(
    ffmpeg()
      .input("anullsrc=r=24000:cl=mono")
      .inputOptions(["-f", "lavfi", "-t", "0.45"])
      .input(tmp)
      .complexFilter(["[0:a][1:a]concat=n=2:v=0:a=1[out]"])
      .outputOptions(["-map", "[out]"])
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .output(outputPath),
  );

  await fs.rm(tmp, { force: true });
}

async function synthesizeWithEdge(text: string, rawPath: string) {
  const communicate = new Communicate(text, {
    voice: EDGE_VOICE,
    rate: "-5%",
    volume: "+25%",
    pitch: "+0Hz",
  });

  const chunks: Buffer[] = [];
  for await (const chunk of communicate.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      chunks.push(Buffer.from(chunk.data));
    }
  }

  if (chunks.length === 0) {
    throw new Error("Edge TTS returned no audio");
  }

  await fs.mkdir(path.dirname(rawPath), { recursive: true });
  await fs.writeFile(rawPath, Buffer.concat(chunks));
}

async function synthesizeWithOpenAI(text: string, rawPath: string) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const speech = await openai.audio.speech.create({
    model: "tts-1",
    voice: OPENAI_VOICE,
    input: text,
    response_format: "mp3",
  });
  const buffer = Buffer.from(await speech.arrayBuffer());
  await fs.mkdir(path.dirname(rawPath), { recursive: true });
  await fs.writeFile(rawPath, buffer);
}

/**
 * Generate spoken English translation audio.
 * Default: free Edge TTS (reliable). Optional OpenAI if credits exist.
 */
export async function synthesizeTranslationMp3(
  text: string,
  outputPath: string,
): Promise<void> {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    throw new Error("Empty translation text for TTS");
  }

  // Speak a short cue so listeners notice English started
  const spoken = `English. ${cleaned}`;
  const rawPath = `${outputPath}.raw.mp3`;

  let made = false;
  if (preferOpenAI()) {
    try {
      await synthesizeWithOpenAI(spoken, rawPath);
      made = true;
    } catch (err) {
      console.warn("OpenAI TTS failed, falling back to Edge TTS:", err);
    }
  }

  if (!made) {
    await synthesizeWithEdge(spoken, rawPath);
  }

  try {
    await boostEnglishClip(rawPath, outputPath);
  } catch (err) {
    console.warn("English boost failed, using raw TTS clip:", err);
    await fs.copyFile(rawPath, outputPath);
  } finally {
    await fs.rm(rawPath, { force: true });
  }
}
