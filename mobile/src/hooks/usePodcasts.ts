import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import {
  clearPending,
  getPending,
  subscribePending,
} from "../state/pendingPodcasts";

/** Raw shape from Supabase (snake_case DB columns).
 *
 * `chapter_markers` is a JSONB column; the inner JSON is whatever the
 * pipeline writes — `metadataWriter` writes camelCase `timestampSeconds`,
 * so we read it back camelCase. The DB column name is still snake_case,
 * but the JSON inside is not. */
export interface PodcastRow {
  id: string;
  topic: string;
  status: string;
  audio_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  chapter_markers: Array<{ timestampSeconds: number; title: string }>;
  has_ads: boolean;
  created_at: string;
  error_message: string | null;
  status_started_at: string | null;
  parent_podcast_id: string | null;
  source_chapter_title: string | null;
  share_token: string | null;
  clarifying_answers: Array<{ q: string; a: string }> | null;
}

/** App-level type — camelCase to match TypeScript pipeline conventions */
export interface Podcast {
  id: string;
  topic: string;
  status: string;
  audioUrl: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  chapterMarkers: Array<{ timestampSeconds: number; title: string }>;
  hasAds: boolean;
  createdAt: string;
  errorMessage: string | null;
  statusStartedAt: string | null;
  parentPodcastId: string | null;
  sourceChapterTitle: string | null;
  shareToken: string | null;
  clarifyingAnswers: Array<{ q: string; a: string }>;
}

export function toPodcast(row: PodcastRow): Podcast {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    audioUrl: row.audio_url,
    coverUrl: row.cover_url,
    durationSeconds: row.duration_seconds,
    chapterMarkers: (row.chapter_markers ?? []).map((ch) => ({
      timestampSeconds: ch.timestampSeconds,
      title: ch.title,
    })),
    hasAds: row.has_ads,
    createdAt: row.created_at,
    errorMessage: row.error_message,
    statusStartedAt: row.status_started_at ?? row.created_at,
    parentPodcastId: row.parent_podcast_id,
    sourceChapterTitle: row.source_chapter_title,
    shareToken: row.share_token,
    clarifyingAnswers: row.clarifying_answers ?? [],
  };
}

export function usePodcasts() {
  const { user } = useAuth();
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Optimistically deleted rows kept around for the undo window so restore()
  // can re-insert without a network round-trip.
  const pendingDeletes = useRef(new Map<string, Podcast>()).current;
  // Optimistically inserted rows pushed by Generate the moment submitPodcast
  // resolves. Cleared once the matching server row appears via realtime
  // INSERT or refetch.
  const [pendingInserts, setPendingInserts] = useState<Podcast[]>(() =>
    getPending(),
  );

  useEffect(() => {
    const unsub = subscribePending(() => setPendingInserts(getPending()));
    return unsub;
  }, []);

  useEffect(() => {
    if (pendingInserts.length === 0) return;
    const serverIds = new Set(podcasts.map((p) => p.id));
    for (const p of pendingInserts) {
      if (serverIds.has(p.id)) clearPending(p.id);
    }
  }, [podcasts, pendingInserts]);

  const fetchPodcasts = useCallback(async () => {
    if (!user) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      // Library renders parents only. Expansions live inside their
      // parent's chapter list — the cascade trigger on `deleted_at`
      // (migration 00021) ensures expansions are gone whenever the
      // parent is, so we never need to surface orphans.
      const { data, error } = await supabase
        .from("podcasts")
        .select(`
          id, topic, status, audio_url, cover_url, duration_seconds, chapter_markers,
          has_ads, created_at, error_message, status_started_at,
          parent_podcast_id, source_chapter_title, share_token, clarifying_answers
        `)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .is("parent_podcast_id", null)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setPodcasts((data as unknown as PodcastRow[]).map(toPodcast));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPodcasts();

    // Real-time subscription for status updates
    if (!user) return;

    const channel = supabase
      .channel("podcast-status")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "podcasts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Library renders parents only; expansion updates never match
          // a row in our list. Short-circuit so the no-op map doesn't run.
          if (payload.new.parent_podcast_id) return;
          setPodcasts((prev) =>
            prev.map((p) =>
              p.id === payload.new.id
                ? toPodcast(payload.new as PodcastRow)
                : p,
            ),
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "podcasts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Expansion INSERTs would be a nested row, not a library entry.
          if (payload.new.parent_podcast_id) return;
          setPodcasts((prev) => [toPodcast(payload.new as PodcastRow), ...prev]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchPodcasts]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchPodcasts();
  }, [fetchPodcasts]);

  // Background refetch for programmatic triggers (focus refresh, etc.).
  // Skips the `refreshing` flag so the FlatList's RefreshControl spinner
  // doesn't fire — that visual is reserved for user-initiated pull-to-
  // refresh, not for "I came back to this tab."
  const silentRefresh = useCallback(() => {
    fetchPodcasts();
  }, [fetchPodcasts]);

  // Optimistic soft-delete: stash the row + drop it locally so it vanishes
  // immediately, then write deleted_at on the server. restore() reverses
  // the column write and re-inserts the stashed row at its original
  // position (sorted by created_at desc).
  //
  // The direct `.update({ deleted_at })` path silently fails server-side:
  // supabase-js appends RETURNING which forces Postgres to re-check the
  // SELECT policy (USING `deleted_at IS NULL`) against the post-update
  // row, and the soft-deleted row is no longer visible to that policy.
  // Postgres rejects with sqlstate 42501 "violates row-level security",
  // the row never gets soft-deleted on the server, and the next refresh
  // re-fetches it. soft_delete_podcast is a SECURITY DEFINER RPC
  // (migration 00026) that owns the bypass after asserting ownership.
  const softDelete = useCallback(
    async (id: string) => {
      setPodcasts((prev) => {
        const target = prev.find((p) => p.id === id);
        if (target) pendingDeletes.set(id, target);
        return prev.filter((p) => p.id !== id);
      });
      const { error } = await supabase.rpc("soft_delete_podcast", { p_id: id });
      if (error) {
        console.warn("soft_delete_podcast RPC failed:", error);
      }
    },
    [pendingDeletes],
  );

  const restore = useCallback(
    async (id: string) => {
      const stashed = pendingDeletes.get(id);
      pendingDeletes.delete(id);
      if (stashed) {
        setPodcasts((prev) => {
          if (prev.some((p) => p.id === id)) return prev;
          const next = [...prev, stashed];
          next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return next;
        });
      }
      // The podcasts UPDATE policy is locked to soft-delete only (migration
      // 00007 WITH CHECK: deleted_at IS NOT NULL), so a direct
      // .update({ deleted_at: null }) silently filters to zero rows.
      // restore_podcast is a SECURITY DEFINER RPC (migration 00024) that
      // owns the bypass after asserting auth.uid() = user_id internally.
      // The cascade trigger fires on the parent UPDATE and restores
      // descendants belonging to the same owner.
      await supabase.rpc("restore_podcast", { p_id: id });
    },
    [pendingDeletes],
  );

  // Merge optimistic rows ahead of server rows, deduped by id (server wins).
  // Sort by createdAt desc so a fresh optimistic row sits at the top until
  // the server row replaces it.
  const visiblePodcasts = useMemo(() => {
    if (pendingInserts.length === 0) return podcasts;
    const serverIds = new Set(podcasts.map((p) => p.id));
    const fresh = pendingInserts.filter((p) => !serverIds.has(p.id));
    if (fresh.length === 0) return podcasts;
    const merged = [...fresh, ...podcasts];
    merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return merged;
  }, [podcasts, pendingInserts]);

  return {
    podcasts: visiblePodcasts,
    loading,
    refreshing,
    refresh,
    silentRefresh,
    softDelete,
    restore,
  };
}
