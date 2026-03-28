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
import { GoogleWaveNetTTS } from "../providers/ttsGoogle.js";
import { getSupabaseClient } from "../providers/supabaseClient.js";
import type { PipelineStateType } from "../state.js";

const AD_AUDIO_DIR = process.env.AD_AUDIO_DIR ?? "ad_assets";

interface ScriptSegment {
  type: "text" | "ad";
  content?: string;
  adType?: string;
}

function getTtsProvider(): TTSProvider {
  return new GoogleWaveNetTTS();
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
        const audioBytes = await tts.synthesize(segment.content);
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
  const { script, podcastId, userId } = state;

  const tts = getTtsProvider();
  const segments = splitScriptSegments(script);
  const { audioBytes, durationSeconds } = await stitchAudio(segments, tts);

  const supabase = getSupabaseClient();
  const storagePath = `${userId}/${podcastId}.mp3`;

  await supabase.storage.from("podcast-audio").upload(storagePath, audioBytes, {
    contentType: "audio/mpeg",
  });

  const { data } = supabase.storage
    .from("podcast-audio")
    .getPublicUrl(storagePath);

  return {
    audioUrl: data.publicUrl,
    durationSeconds,
    status: "generating_audio",
  };
}
