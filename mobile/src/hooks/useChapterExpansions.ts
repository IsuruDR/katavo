/**
 * For a given parent podcast id, fetch the set of chapter expansions
 * the user has spawned and subscribe to realtime updates so the
 * UI flips chapter affordances as generation completes.
 *
 * Returns:
 *   Map<chapterTitle, { podcastId, status }>
 *
 * Skips listing if the parent has no chapter_transcripts (legacy podcast
 * predating migration 00019) — caller hides the Expand affordance entirely.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export type ExpansionStatus =
  | "queued"
  | "researching"
  | "fact_checking"
  | "scripting"
  | "generating_audio"
  | "complete"
  | "failed";

export interface ExpansionEntry {
  podcastId: string;
  status: ExpansionStatus;
}

export type ExpansionMap = Map<string, ExpansionEntry>;

export interface UseChapterExpansionsResult {
  expansions: ExpansionMap;
  /** Parent itself can't be expanded — show no Expand affordance at all. */
  parentExpandable: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useChapterExpansions(parentPodcastId: string | null): UseChapterExpansionsResult {
  const [expansions, setExpansions] = useState<ExpansionMap>(new Map());
  const [parentExpandable, setParentExpandable] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    if (!parentPodcastId) {
      setExpansions(new Map());
      setParentExpandable(false);
      setLoading(false);
      return;
    }

    const { data: parent } = await supabase
      .from("podcasts")
      .select("chapter_transcripts")
      .eq("id", parentPodcastId)
      .single();
    setParentExpandable(!!parent?.chapter_transcripts);

    const { data: rows } = await supabase
      .from("podcasts")
      .select("id, source_chapter_title, status")
      .eq("parent_podcast_id", parentPodcastId)
      .is("deleted_at", null);

    const map: ExpansionMap = new Map();
    for (const r of rows ?? []) {
      if (r.source_chapter_title) {
        map.set(r.source_chapter_title, {
          podcastId: r.id,
          status: r.status as ExpansionStatus,
        });
      }
    }
    setExpansions(map);
    setLoading(false);
  }, [parentPodcastId]);

  useEffect(() => {
    fetchOnce();
    if (!parentPodcastId) return;

    const channel = supabase
      .channel(`expansions-${parentPodcastId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "podcasts",
          filter: `parent_podcast_id=eq.${parentPodcastId}`,
        },
        () => {
          fetchOnce();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parentPodcastId, fetchOnce]);

  return { expansions, parentExpandable, loading, refresh: fetchOnce };
}
