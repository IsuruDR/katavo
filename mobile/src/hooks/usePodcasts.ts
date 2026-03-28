import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface PodcastRow {
  id: string;
  topic: string;
  status: string;
  audio_url: string | null;
  duration_seconds: number | null;
  chapter_markers: Array<{ timestamp_seconds: number; title: string }>;
  has_ads: boolean;
  created_at: string;
  error_message: string | null;
}

/** App-level type — camelCase to match TypeScript pipeline conventions */
export interface Podcast {
  id: string;
  topic: string;
  status: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  chapterMarkers: Array<{ timestampSeconds: number; title: string }>;
  hasAds: boolean;
  createdAt: string;
  errorMessage: string | null;
}

function toPodcast(row: PodcastRow): Podcast {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    audioUrl: row.audio_url,
    durationSeconds: row.duration_seconds,
    chapterMarkers: (row.chapter_markers ?? []).map((ch) => ({
      timestampSeconds: ch.timestamp_seconds,
      title: ch.title,
    })),
    hasAds: row.has_ads,
    createdAt: row.created_at,
    errorMessage: row.error_message,
  };
}

export function usePodcasts() {
  const { user } = useAuth();
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPodcasts = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("podcasts")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (!error && data) setPodcasts((data as PodcastRow[]).map(toPodcast));
    setLoading(false);
    setRefreshing(false);
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
          setPodcasts((prev) =>
            prev.map((p) =>
              p.id === payload.new.id ? toPodcast(payload.new as PodcastRow) : p
            )
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

  return { podcasts, loading, refreshing, refresh };
}
