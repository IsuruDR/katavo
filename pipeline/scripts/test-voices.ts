/**
 * One-off voice A/B utility. Renders the first chapter of a completed
 * podcast through 4 candidate voices using the new TTS_VOICE_INSTRUCTIONS,
 * writes mp3s locally for side-by-side listening.
 *
 * Run: cd pipeline && npx tsx scripts/test-voices.ts
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (or .env)
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { TTS_VOICE_INSTRUCTIONS } from "../src/podcast_pipeline/config.js";

const VOICES = ["coral", "sage", "ash", "ballad"] as const;
const OUT_DIR = "voice-test";

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: podcasts, error } = await supabase
    .from("podcasts")
    .select("id, topic, transcript")
    .eq("status", "complete")
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !podcasts || podcasts.length === 0) {
    throw new Error(`No complete podcast found: ${error?.message ?? "empty result"}`);
  }

  const { id, topic, transcript } = podcasts[0];
  if (!transcript) throw new Error(`Podcast ${id} has null transcript`);

  // Take the first ~280 words — roughly one chapter, ~75-90s of audio.
  const words = transcript.split(/\s+/).slice(0, 280);
  const chapter = words.join(" ");

  console.log(`Source podcast: ${id}`);
  console.log(`Topic: ${topic}`);
  console.log(`Chapter sample: ${words.length} words, ${chapter.length} chars`);

  mkdirSync(OUT_DIR, { recursive: true });

  const openai = new OpenAI();
  for (const voice of VOICES) {
    console.log(`Rendering ${voice}...`);
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: chapter,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const buf = Buffer.from(await response.arrayBuffer());
    const path = join(OUT_DIR, `voice-${voice}.mp3`);
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }

  console.log("\nDone. Listen with:");
  for (const voice of VOICES) {
    console.log(`  open ${OUT_DIR}/voice-${voice}.mp3`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
