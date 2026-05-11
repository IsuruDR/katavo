/**
 * Converts script to audio via TTS, stitches ads, uploads to Supabase Storage.
 *
 * Chunking strategy: split each text block on [CHAPTER:] markers; if any
 * resulting chapter exceeds MAX_WORDS_PER_TTS_CHUNK, sub-split on sentence
 * boundaries. Gemini TTS rushes the latter half of audio output when given
 * inputs over roughly 400 words in a single call — chapter-sized chunks
 * keep each call inside the safe zone.
 *
 * Chunks are synthesized with bounded parallelism so a single podcast
 * doesn't burn through Gemini's RPM quota; ad segments stay sequential
 * (just disk reads). Concat re-encodes with libmp3lame to produce a
 * clean single-stream MP3 with a correct Xing header — `-c copy` would
 * carry over the first segment's header and cause players to speed up
 * the latter portion to fit reported duration.
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AD_PRE_ROLL_MARKER,
  AD_MID_ROLL_MARKER,
  MAX_WORDS_PER_TTS_CHUNK,
  TTS_CONCURRENCY_PER_PODCAST,
  TTS_RETRY_ATTEMPTS,
  TTS_RETRY_BASE_DELAY_MS,
} from "../config.js";
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

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Sentence-aware fallback chunker. Only invoked when a chapter exceeds
 * maxWords. Greedy: accumulate sentences until adding one more would
 * push past the limit, then start a new chunk. If a single sentence is
 * already over the limit, it ships as its own oversized chunk — better
 * than mid-sentence cuts.
 */
export function splitOnSentences(text: string, maxWords: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const sentenceWords = countWords(trimmed);
    if (currentWords > 0 && currentWords + sentenceWords > maxWords) {
      chunks.push(current);
      current = trimmed;
      currentWords = sentenceWords;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
      currentWords += sentenceWords;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Split a text block on [CHAPTER:] markers, then apply the word-count
 * guard. Each output string is ready for a single Gemini TTS call.
 */
export function splitTextIntoChapterChunks(
  text: string,
  maxWords = MAX_WORDS_PER_TTS_CHUNK,
): string[] {
  const chapterPieces = text.split(/\[CHAPTER:[^\]]+\]/);
  const result: string[] = [];
  for (const piece of chapterPieces) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (countWords(trimmed) <= maxWords) {
      result.push(trimmed);
    } else {
      result.push(...splitOnSentences(trimmed, maxWords));
    }
  }
  return result;
}

export function splitScriptSegments(
  script: string,
  maxWordsPerChunk = MAX_WORDS_PER_TTS_CHUNK,
): ScriptSegment[] {
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
      const chunks = splitTextIntoChapterChunks(stripped, maxWordsPerChunk);
      for (const content of chunks) {
        segments.push({ type: "text", content });
      }
    }
  }

  return segments;
}

async function synthesizeWithRetry(
  text: string,
  tts: TTSProvider,
  voice: string | undefined,
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TTS_RETRY_ATTEMPTS; attempt++) {
    try {
      return await tts.synthesize(text, voice);
    } catch (err) {
      lastErr = err;
      if (attempt < TTS_RETRY_ATTEMPTS) {
        const delayMs = TTS_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export async function stitchAudio(
  segments: ScriptSegment[],
  tts: TTSProvider,
  voice?: string | null,
): Promise<{ audioBytes: Buffer; durationSeconds: number }> {
  const tempDir = mkdtempSync(join(tmpdir(), "podcast-audio-"));

  try {
    // Synthesize text segments with bounded parallelism. Workers pull from
    // a shared cursor, write each result keyed by original segment index.
    const textIndices: number[] = [];
    segments.forEach((seg, i) => {
      if (seg.type === "text" && seg.content) textIndices.push(i);
    });

    const textPaths = new Map<number, string>();
    let cursor = 0;
    const workerCount = Math.min(TTS_CONCURRENCY_PER_PODCAST, textIndices.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const slot = cursor++;
        if (slot >= textIndices.length) return;
        const segIdx = textIndices[slot];
        const seg = segments[segIdx];
        const audioBytes = await synthesizeWithRetry(
          seg.content!,
          tts,
          voice ?? undefined,
        );
        const partPath = join(tempDir, `part_${segIdx}.mp3`);
        writeFileSync(partPath, audioBytes);
        textPaths.set(segIdx, partPath);
      }
    });
    await Promise.all(workers);

    // Build the ordered file list — ads interleaved with synthesized chunks
    // at their original positions.
    const partFiles: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === "ad" && seg.adType) {
        const adFile = join(AD_AUDIO_DIR, `${seg.adType}.mp3`);
        try {
          readFileSync(adFile);
          partFiles.push(adFile);
        } catch {
          // Ad file not found — skip
        }
      } else if (seg.type === "text" && seg.content) {
        const path = textPaths.get(i);
        if (path) partFiles.push(path);
      }
    }

    if (partFiles.length === 0) {
      return { audioBytes: Buffer.alloc(0), durationSeconds: 0 };
    }

    const listFile = join(tempDir, "files.txt");
    const listContent = partFiles.map((f) => `file '${f}'`).join("\n");
    writeFileSync(listFile, listContent);

    // Re-encode at concat (not -c copy). With multiple per-chapter chunks,
    // -c copy would preserve only the first segment's Xing/LAME header,
    // and players would speed up the latter portion to fit reported
    // duration. libmp3lame qscale=2 here matches the per-chunk encode in
    // ttsGemini and regenerates a single correct header for the merged
    // stream.
    const outputPath = join(tempDir, "output.mp3");
    execSync(
      `ffmpeg -f concat -safe 0 -i "${listFile}" -c:a libmp3lame -qscale:a 2 "${outputPath}" -y`,
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
