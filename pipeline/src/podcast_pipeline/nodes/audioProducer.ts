/**
 * Converts script to audio via TTS, stitches ads, uploads to Supabase Storage.
 * Uses ffmpeg for audio concatenation.
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../config.js";
import type { TTSProvider } from "../providers/ttsBase.js";
import { GeminiTTS } from "../providers/ttsGemini.js";
import { getSupabaseClient } from "../providers/supabaseClient.js";
import { persistStatus } from "./persistStatus.js";
import type { PipelineStateType } from "../state.js";

const AD_AUDIO_DIR = process.env.AD_AUDIO_DIR ?? "ad_assets";

interface ScriptSegment {
  type: "text" | "ad";
  content?: string;
  adType?: string;
}

function getTtsProvider(): TTSProvider {
  return new GeminiTTS();
}

export function splitScriptSegments(script: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  const escapedPre = AD_PRE_ROLL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedMid = AD_MID_ROLL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = script.split(new RegExp(`(${escapedPre}|${escapedMid})`));

  for (const part of parts) {
    const stripped = part.trim();
    if (!stripped) continue;

    if (stripped === AD_PRE_ROLL_MARKER) {
      segments.push({ type: "ad", adType: "pre_roll" });
    } else if (stripped === AD_MID_ROLL_MARKER) {
      segments.push({ type: "ad", adType: "mid_roll" });
    } else {
      const cleanText = stripped.replace(/\[CHAPTER:[^\]]+\]\n?/g, "").trim();
      if (cleanText) {
        segments.push({ type: "text", content: cleanText });
      }
    }
  }

  return segments;
}

export async function stitchAudio(
  segments: ScriptSegment[],
  tts: TTSProvider,
  voice?: string | null,
): Promise<{ audioBytes: Buffer; durationSeconds: number }> {
  const tempDir = mkdtempSync(join(tmpdir(), "podcast-audio-"));

  try {
    const partFiles: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type === "ad" && segment.adType) {
        const adFile = join(AD_AUDIO_DIR, `${segment.adType}.mp3`);
        try {
          readFileSync(adFile);
          partFiles.push(adFile);
        } catch {
          // Ad file not found — skip
        }
      } else if (segment.type === "text" && segment.content) {
        const audioBytes = await tts.synthesize(segment.content, voice ?? undefined);
        const partPath = join(tempDir, `part_${i}.mp3`);
        writeFileSync(partPath, audioBytes);
        partFiles.push(partPath);
      }
    }

    if (partFiles.length === 0) {
      return { audioBytes: Buffer.alloc(0), durationSeconds: 0 };
    }

    const listFile = join(tempDir, "files.txt");
    const listContent = partFiles.map((f) => `file '${f}'`).join("\n");
    writeFileSync(listFile, listContent);

    const outputPath = join(tempDir, "output.mp3");
    execSync(
      `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}" -y`,
      { stdio: "pipe" },
    );

    const audioBytes = readFileSync(outputPath);

    const durationOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
      { encoding: "utf-8" },
    ).trim();
    const durationSeconds = Math.round(parseFloat(durationOutput) || 0);

    return { audioBytes: Buffer.from(audioBytes), durationSeconds };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function audioProducer(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { taggedScript, script, podcastId, userId } = state;
  const sourceScript = taggedScript || script; // fallthrough if tagInjector failed silently

  await persistStatus(podcastId, "generating_audio");

  const tts = getTtsProvider();
  const segments = splitScriptSegments(sourceScript);
  const { audioBytes, durationSeconds } = await stitchAudio(segments, tts, state.voice);

  const supabase = getSupabaseClient();
  const storagePath = `${userId}/${podcastId}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from("podcast-audio")
    .upload(storagePath, audioBytes, {
      contentType: "audio/mpeg",
    });
  if (uploadError)
    throw new Error(`Failed to upload audio: ${uploadError.message}`);

  const { data, error: signedUrlError } = await supabase.storage
    .from("podcast-audio")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year expiry

  if (signedUrlError || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedUrlError?.message ?? "unknown error"}`);
  }

  return {
    audioUrl: data.signedUrl,
    durationSeconds,
    status: "generating_audio",
  };
}
