/**
 * One-time build script. Generates a ~10-second coach-mark MP3 per Gemini
 * voice. Normalizes loudness to roughly match Gemini's TTS output so the
 * final libmp3lame re-encode at concat doesn't produce an audible level
 * shift at the join.
 *
 * Run via: cd pipeline && npx tsx scripts/build-coachmark-audio.ts
 * Output:  pipeline/coachmark_audio/coachmark_expand_<voice>.mp3 × 4
 *
 * The output files are checked into the repo (small, deterministic per
 * voice + script text). Re-run only when the coach-mark copy changes.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const COACHMARK_TEXT =
  "One more thing — those chapter markers you see? Tap any of them and I'll spin it into its own deeper episode. Just for the bits that grabbed you.";

const VOICES = ["Sulafat", "Charon", "Sadaltager", "Achird"] as const;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "coachmark_audio");
const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";

async function generateOne(voice: string): Promise<void> {
  const outPath = join(OUTPUT_DIR, `coachmark_expand_${voice}.mp3`);

  console.log(`[build-coachmark] generating ${voice} → ${outPath}`);

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const response = await client.models.generateContent({
    model: GEMINI_TTS_MODEL,
    contents: COACHMARK_TEXT,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  } as any);

  const inlineData =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((response as any).candidates?.[0]?.content?.parts ?? []).find(
      (p: any) => p.inlineData?.data,
    )?.inlineData;

  if (!inlineData?.data) {
    throw new Error(`Gemini TTS returned no audio for voice ${voice}`);
  }

  const pcmBytes = Buffer.from(inlineData.data, "base64");
  const tmpPcm = join(OUTPUT_DIR, `.tmp_${voice}.pcm`);
  const tmpUnnormMp3 = join(OUTPUT_DIR, `.tmp_${voice}_unnorm.mp3`);

  writeFileSync(tmpPcm, pcmBytes);

  // 1. PCM → unnormalized MP3, same encoding as ttsGemini.ts so concat re-encode
  //    doesn't mismatch: -f s16le -ar 24000 -ac 1 -codec:a libmp3lame -qscale:a 2
  execSync(
    `ffmpeg -f s16le -ar 24000 -ac 1 -i "${tmpPcm}" -codec:a libmp3lame -qscale:a 2 "${tmpUnnormMp3}" -y`,
    { stdio: "pipe" },
  );

  // 2. Apply loudnorm to match Gemini's typical output level.
  //    Target: -16 LUFS integrated, true peak -1.5 dBTP, LRA 11.
  execSync(
    `ffmpeg -i "${tmpUnnormMp3}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -codec:a libmp3lame -qscale:a 2 "${outPath}" -y`,
    { stdio: "pipe" },
  );

  // 3. Cleanup
  unlinkSync(tmpPcm);
  unlinkSync(tmpUnnormMp3);

  console.log(`[build-coachmark] done: ${outPath}`);
}

async function main(): Promise<void> {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set — load it via .env");
  }
  for (const voice of VOICES) {
    await generateOne(voice);
  }
  console.log("[build-coachmark] all voices done");
}

main().catch((err) => {
  console.error("[build-coachmark] failed:", err);
  process.exit(1);
});
