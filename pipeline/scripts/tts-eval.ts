/**
 * tts-eval — fast iteration loop for podcast audio quality.
 *
 * Bypasses the research/scripting pipeline. Takes a script (from a file
 * or an existing podcast row) and runs only tagInjector (optional) + TTS,
 * so you can A/B voices, tag densities, or script rhythm in ~10-30s
 * instead of waiting ~10min and burning $1 on a full pipeline run.
 *
 * Usage:
 *   tsx scripts/tts-eval.ts --script samples/test-script.md
 *   tsx scripts/tts-eval.ts --script samples/clean.md --inject-tags --voice Charon
 *   tsx scripts/tts-eval.ts --from-db <podcast-id> --voice Sadaltager
 *
 * Flags:
 *   --script PATH         Read script text from file
 *   --from-db PODCAST_ID  Pull tagged_script (preferred) or script from DB
 *   --voice NAME          One of Sulafat | Charon | Sadaltager | Achird
 *                         (default: Sulafat)
 *   --inject-tags         Run tagInjector before TTS (script must be clean
 *                         prose — no existing audio tags)
 *   --output PATH         Output MP3 path (default: out.mp3 in cwd)
 *   --no-open             Skip the auto-open after writing the MP3
 *
 * Requires:
 *   GEMINI_API_KEY in pipeline/.env
 *   For --from-db: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

import { GeminiTTS } from "../src/podcast_pipeline/providers/ttsGemini.js";
import { tagInjector } from "../src/podcast_pipeline/nodes/tagInjector.js";
import {
  DEFAULT_GEMINI_VOICE,
  GEMINI_VOICES,
} from "../src/podcast_pipeline/config.js";
import type { PipelineStateType } from "../src/podcast_pipeline/state.js";

interface Args {
  script?: string;
  fromDb?: string;
  voice: string;
  injectTags: boolean;
  output: string;
  open: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    voice: DEFAULT_GEMINI_VOICE,
    injectTags: false,
    output: "out.mp3",
    open: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--script":
        args.script = argv[++i];
        break;
      case "--from-db":
        args.fromDb = argv[++i];
        break;
      case "--voice":
        args.voice = argv[++i];
        break;
      case "--inject-tags":
        args.injectTags = true;
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--no-open":
        args.open = false;
        break;
      case "-h":
      case "--help":
        printHelpAndExit();
        break;
      default:
        if (a?.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          printHelpAndExit(1);
        }
    }
  }
  return args;
}

function printHelpAndExit(code = 0): never {
  console.log(
    `tts-eval — fast TTS iteration\n\n` +
      `Usage:\n` +
      `  tsx scripts/tts-eval.ts --script samples/test-script.md\n` +
      `  tsx scripts/tts-eval.ts --script samples/clean.md --inject-tags --voice Charon\n` +
      `  tsx scripts/tts-eval.ts --from-db <podcast-id> --voice Sadaltager\n\n` +
      `Voices: ${GEMINI_VOICES.join(" | ")} (default ${DEFAULT_GEMINI_VOICE})\n`,
  );
  process.exit(code);
}

async function loadScript(args: Args): Promise<string> {
  if (args.script) {
    const path = resolve(args.script);
    return readFileSync(path, "utf-8");
  }
  if (args.fromDb) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "--from-db requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data, error } = await supabase
      .from("podcasts")
      .select("transcript, status")
      .eq("id", args.fromDb)
      .single();
    if (error || !data) {
      throw new Error(`No podcast row for id ${args.fromDb}: ${error?.message}`);
    }
    if (!data.transcript) {
      throw new Error(
        `Podcast ${args.fromDb} has no transcript (status: ${data.status})`,
      );
    }
    return data.transcript as string;
  }
  throw new Error("must provide --script or --from-db");
}

async function maybeInjectTags(
  script: string,
  injectTags: boolean,
): Promise<string> {
  if (!injectTags) return script;
  console.log("[tts-eval] running tagInjector…");
  const start = Date.now();
  const state = { script, podcastId: "tts-eval" } as PipelineStateType;
  const result = await tagInjector(state);
  const taggedScript = result.taggedScript ?? script;
  console.log(
    `[tts-eval] tagInjector done in ${((Date.now() - start) / 1000).toFixed(1)}s`,
  );
  return taggedScript;
}

function openFile(path: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync(`open "${path}"`);
    } else if (platform === "linux") {
      execSync(`xdg-open "${path}"`);
    } else if (platform === "win32") {
      execSync(`start "" "${path}"`);
    } else {
      console.log(`[tts-eval] platform ${platform} — open the file manually`);
    }
  } catch {
    console.log("[tts-eval] couldn't auto-open; open the file manually");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set — load it via pipeline/.env");
  }

  const script = await loadScript(args);
  const taggedScript = await maybeInjectTags(script, args.injectTags);

  console.log(`[tts-eval] synthesizing (voice=${args.voice})…`);
  const start = Date.now();
  const tts = new GeminiTTS();
  const audioBytes = await tts.synthesize(taggedScript, args.voice);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  const outPath = resolve(args.output);
  writeFileSync(outPath, audioBytes);
  console.log(
    `[tts-eval] wrote ${outPath} (${(audioBytes.length / 1024).toFixed(1)} KB) in ${seconds}s`,
  );

  if (args.open) {
    openFile(outPath);
  }
}

main().catch((err) => {
  console.error("[tts-eval] failed:", err?.message ?? err);
  process.exit(1);
});
