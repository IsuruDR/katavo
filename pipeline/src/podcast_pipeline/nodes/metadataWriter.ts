/**
 * Generates metadata, stores research context, updates Supabase, sends notification.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";
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

export async function metadataWriter(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const { podcastId, script } = state;
  const duration = state.durationSeconds ?? 0;

  const chapters = extractChapters(script, duration);

  // Clean transcript (remove markers)
  const transcript = script
    .replace(/\[CHAPTER:[^\]]+\]\n?/g, "")
    .replace(/\[AD:[^\]]+\]\n?/g, "")
    .trim();

  const supabase = getSupabaseClient();

  // Update podcast record (now includes chapter_research_map)
  const { error: updateError } = await supabase
    .from("podcasts")
    .update({
      status: "complete",
      audio_url: state.audioUrl,
      transcript,
      duration_seconds: duration,
      chapter_markers: chapters,
      chapter_research_map: state.chapterResearchMap ?? null,
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
