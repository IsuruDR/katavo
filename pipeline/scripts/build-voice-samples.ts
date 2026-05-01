/**
 * Build script: renders the 4 self-introducing voice samples used by
 * the mobile onboarding voice picker. Run on demand when:
 *   - TTS_VOICE_INSTRUCTIONS in config.ts changes
 *   - The sample copy below changes
 *   - We add or remove a voice
 *
 * Output: mobile/assets/voice-samples/{voice}.mp3 (committed)
 *
 * Run: cd pipeline && npx tsx scripts/build-voice-samples.ts
 *
 * Env: OPENAI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { TTS_VOICE_INSTRUCTIONS } from "../src/podcast_pipeline/config.js";

const SAMPLES = [
  {
    voice: "coral",
    script:
      "I'm Coral. Warm, natural, easy to listen to. Like the friend who explains things over coffee without making you feel small.",
  },
  {
    voice: "sage",
    script:
      "I'm Sage. Thoughtful, contemplative. I take my time on the parts that matter.",
  },
  {
    voice: "ash",
    script: "I'm Ash. Calm, steady, low-key. I won't oversell anything to you.",
  },
  {
    voice: "ballad",
    script:
      "I'm Ballad. Expressive, a little theatrical. Good for stories that have shape.",
  },
] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, "../../mobile/assets/voice-samples");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const openai = new OpenAI();

  for (const { voice, script } of SAMPLES) {
    console.log(`Rendering ${voice}...`);
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: script,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const buf = Buffer.from(await response.arrayBuffer());
    const path = join(OUT_DIR, `${voice}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. 4 mp3s written to mobile/assets/voice-samples/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
