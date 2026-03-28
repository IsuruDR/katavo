/**
 * Generates metadata, stores research context, updates Supabase, sends notification.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import type { PipelineStateType } from "../state.js";

const NOTIFY_COMPLETE_URL = process.env.NOTIFY_COMPLETE_URL ?? "";

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

  // Update podcast record
  await supabase
    .from("podcasts")
    .update({
      status: "complete",
      audio_url: state.audioUrl,
      transcript,
      duration_seconds: duration,
      chapter_markers: chapters,
    })
    .eq("id", podcastId);

  // Store research context for Q&A
  await supabase
    .from("research_contexts")
    .insert({
      podcast_id: podcastId,
      research_document: state.researchDocument ?? {},
      sources: state.sources ?? [],
      overall_credibility_score: state.credibilityScore,
      research_iterations: state.researchIterations ?? 1,
    });

  // Send push notification
  if (NOTIFY_COMPLETE_URL) {
    try {
      await fetch(NOTIFY_COMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastId,
          status: "complete",
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Non-critical
    }
  }

  return {
    status: "complete",
    transcript,
    chapterMarkers: chapters,
  };
}
