/**
 * Generates metadata, stores research context, updates Supabase, sends notification.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";
import { generateCoverArtwork } from "./coverArtwork.js";
import type { PipelineStateType } from "../state.js";

interface ChapterMarker {
  timestampSeconds: number;
  title: string;
}

export function extractChapters(
  script: string,
  totalDuration: number,
): ChapterMarker[] {
  const chapterPattern = /\[CHAPTER:\s*([^\]]+)\]/g;
  const matches: { index: number; title: string }[] = [];

  let match: RegExpExecArray | null;
  while ((match = chapterPattern.exec(script)) !== null) {
    matches.push({ index: match.index, title: match[1].trim() });
  }

  if (matches.length === 0) {
    return [{ timestampSeconds: 0, title: "Full Episode" }];
  }

  return matches.map((m) => {
    const positionRatio = m.index / Math.max(script.length, 1);
    const timestamp = Math.round(positionRatio * totalDuration);
    return { timestampSeconds: timestamp, title: m.title };
  });
}

/**
 * Splits the (pre-strip) script on [CHAPTER:] markers and returns a
 * { chapterTitle: chapterText } map. Used to populate podcasts.chapter_transcripts
 * so expansions can extract just the relevant chapter as scriptWriter
 * callback context. The flat transcript field stays as-is (markers stripped,
 * for mobile display).
 */
export function extractChapterTranscripts(script: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on chapter markers but capture the marker so we can pair title+text
  const parts = script.split(/(\[CHAPTER:\s*[^\]]+\])/g);
  // parts looks like: ["preamble", "[CHAPTER: A]", "text A", "[CHAPTER: B]", "text B", ...]
  // Skip the preamble (before first chapter); take pairs of (marker, text)
  for (let i = 1; i < parts.length; i += 2) {
    const markerMatch = parts[i].match(/\[CHAPTER:\s*([^\]]+)\]/);
    if (!markerMatch) continue;
    const title = markerMatch[1].trim();
    const rawText = (parts[i + 1] ?? "");
    // Strip any AD markers that snuck inside; keep prose only
    const text = rawText
      .replace(/\[AD:[^\]]+\]\n?/g, "")
      .trim();
    if (text) {
      result[title] = text;
    }
  }
  return result;
}

export async function metadataWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { podcastId, script, userId, topic } = state;
  const duration = state.durationSeconds ?? 0;

  const chapters = extractChapters(script, duration);

  // Clean transcript (remove markers)
  const transcript = script
    .replace(/\[CHAPTER:[^\]]+\]\n?/g, "")
    .replace(/\[AD:[^\]]+\]\n?/g, "")
    .trim();

  const supabase = getSupabaseClient();

  // Generate + upload lock-screen artwork. Best-effort: if rendering or upload
  // fails, we still complete the podcast — the OS just shows a default
  // artwork-less Now Playing widget.
  let coverUrl: string | null = null;
  try {
    const png = await generateCoverArtwork({
      topic,
      chapterCount: chapters.length,
      durationMinutes: Math.max(1, Math.round(duration / 60)),
    });
    const coverPath = `${userId}/${podcastId}.png`;
    const { error: coverUploadError } = await supabase.storage
      .from("podcast-covers")
      .upload(coverPath, png, { contentType: "image/png", upsert: true });
    if (!coverUploadError) {
      const { data: signed } = await supabase.storage
        .from("podcast-covers")
        .createSignedUrl(coverPath, 60 * 60 * 24 * 365);
      coverUrl = signed?.signedUrl ?? null;
    }
  } catch (err) {
    // Don't fail the pipeline on artwork issues. Log via console; the
    // podcast still completes without a cover image.
    console.error("Cover artwork failed:", err);
  }

  const chapterTranscripts = extractChapterTranscripts(script);

  // Update podcast record (now includes chapter_research_map + cover_url)
  const { error: updateError } = await supabase
    .from("podcasts")
    .update({
      status: "complete",
      audio_url: state.audioUrl,
      transcript,
      duration_seconds: duration,
      chapter_markers: chapters,
      chapter_transcripts: chapterTranscripts,
      chapter_research_map: state.chapterResearchMap ?? null,
      cover_url: coverUrl,
    })
    .eq("id", podcastId);
  if (updateError)
    throw new Error(`Failed to update podcast: ${updateError.message}`);

  // Store research context for Q&A / Deep Dive
  const { error: insertError } = await supabase
    .from("research_contexts")
    .insert({
      podcast_id: podcastId,
      research_document: state.researchDocument ?? {},
      sources: state.sources ?? [],
      raw_response: state.rawResearchResponse ?? null,
      overall_credibility_score: state.credibilityScore,
      research_iterations: state.researchIterations ?? 1,
    });
  if (insertError)
    throw new Error(
      `Failed to insert research context: ${insertError.message}`,
    );

  // Send push notification (direct in-process call, no HTTP overhead)
  try {
    await sendPodcastNotification(podcastId, "complete");
  } catch {
    // Non-critical — notification failure should not fail the pipeline
  }

  return {
    status: "complete",
    transcript,
    chapterMarkers: chapters as unknown as Record<string, unknown>[],
  };
}
