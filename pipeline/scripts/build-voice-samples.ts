/**
 * Build script: renders the 4 self-introducing voice samples used by
 * the mobile onboarding voice picker. Run on demand when:
 *   - The sample copy below changes
 *   - We add or remove a voice
 *
 * Output: mobile/assets/voice-samples/{voice}.mp3 (lowercase, committed)
 *
 * Run: cd pipeline && npx tsx scripts/build-voice-samples.ts
 *
 * Env: GEMINI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiTTS } from "../src/podcast_pipeline/providers/ttsGemini.js";

const SAMPLES = [
  {
    voice: "Sulafat",
    script:
      "[chuckles] Hey, I'm Sulafat. I'll narrate your podcast like a friend who happened to know a lot about whatever you're curious about.",
  },
  {
    voice: "Charon",
    script:
      "I'm Charon. I'll bring substance to the topic — clear, informed, and to the point. [pauses] No fluff.",
  },
  {
    voice: "Sadaltager",
    script:
      "[thoughtful] I'm Sadaltager. Think of me as the person at dinner who actually knows the history behind whatever you brought up.",
  },
  {
    voice: "Achird",
    script:
      "I'm Achird. [chuckles] I'll keep it casual and conversational, like we're catching up over coffee.",
  },
] as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, "../../mobile/assets/voice-samples");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tts = new GeminiTTS();

  for (const { voice, script } of SAMPLES) {
    console.log(`Rendering ${voice}...`);
    const buf = await tts.synthesize(script, voice);
    const path = join(OUT_DIR, `${voice.toLowerCase()}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. 4 mp3s written to mobile/assets/voice-samples/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
