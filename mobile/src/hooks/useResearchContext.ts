/**
 * Lazy fetch of the research artifact for a single podcast.
 *
 * Reads research_contexts joined with podcasts.chapter_research_map +
 * chapter_markers in two round-trips. Module-scoped Map cache returns
 * cached data immediately, then refreshes in the background. Cache
 * clears on auth SIGNED_OUT so user-switch on the same device doesn't
 * flash the previous user's research.
 *
 * RLS scopes ownership server-side (own-row only). Tier gate is purely
 * client-side; callers check tier, this hook doesn't.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export interface ResearchSource {
  url: string;
  title: string;
}

export interface ResearchSection {
  title: string;
  content: string;
}

export interface ResearchClaim {
  text: string;
  sourceIndexes: number[];
}

export interface ResearchDocument {
  sections: ResearchSection[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  droppedQuestions: string[];
}

export interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

export type ChapterResearchMap = Record<string, ChapterResearchEntry>;

export interface ChapterMarker {
  timestampSeconds: number;
  title: string;
}

export interface ResearchContext {
  researchDocument: ResearchDocument;
  chapterResearchMap: ChapterResearchMap | null;
  chapterMarkers: ChapterMarker[];
}

// Module-scoped cache. Cleared via auth-state subscription below.
const cache = new Map<string, ResearchContext>();

// Subscribe once at module load. Clears the cache on SIGNED_OUT so a
// device-shared user switch never serves stale data. RLS would block
// the server read for the new user, but the cached object would still
// flash before that.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    cache.clear();
  }
});

export interface UseResearchContextResult {
  data: ResearchContext | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useResearchContext(
  podcastId: string | null,
): UseResearchContextResult {
  const [data, setData] = useState<ResearchContext | null>(
    podcastId ? cache.get(podcastId) ?? null : null,
  );
  const [loading, setLoading] = useState(!data && podcastId !== null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFresh = useCallback(async () => {
    if (!podcastId) return;
    setError(null);
    try {
      const { data: rc, error: rcErr } = await supabase
        .from("research_contexts")
        .select("research_document")
        .eq("podcast_id", podcastId)
        .maybeSingle();
      if (rcErr) throw rcErr;

      const { data: pod, error: podErr } = await supabase
        .from("podcasts")
        .select("chapter_research_map, chapter_markers")
        .eq("id", podcastId)
        .maybeSingle();
      if (podErr) throw podErr;

      if (!rc?.research_document) {
        // Legacy podcast or failed-mid-pipeline. data stays null; caller
        // renders the "Research isn't available" empty state.
        if (mountedRef.current) {
          setData(null);
          setLoading(false);
        }
        cache.delete(podcastId);
        return;
      }

      const ctx: ResearchContext = {
        researchDocument: rc.research_document as unknown as ResearchDocument,
        chapterResearchMap:
          (pod?.chapter_research_map as unknown as ChapterResearchMap | null) ?? null,
        chapterMarkers:
          (pod?.chapter_markers as unknown as ChapterMarker[] | null) ?? [],
      };
      cache.set(podcastId, ctx);
      if (mountedRef.current) {
        setData(ctx);
        setLoading(false);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err?.message ?? "Couldn't load research");
        setLoading(false);
      }
    }
  }, [podcastId]);

  useEffect(() => {
    if (!podcastId) {
      setData(null);
      setLoading(false);
      return;
    }
    // Stale-while-revalidate: render cached immediately, refetch in
    // background.
    const cached = cache.get(podcastId);
    setData(cached ?? null);
    setLoading(!cached);
    void fetchFresh();
  }, [podcastId, fetchFresh]);

  return {
    data,
    loading,
    error,
    refresh: fetchFresh,
  };
}
