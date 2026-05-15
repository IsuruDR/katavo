/**
 * Fire-and-forget inserts to playback_events. Used by the player to log
 * skip-back / skip-forward taps, which feed the re-engagement push
 * chapter-selection heuristic (skip-back density = "user wanted to
 * re-hear this chapter").
 *
 * Failures are silently swallowed for the audio thread, but logged for
 * diagnostics. SEC-11: the user_id column is NOT NULL with no default,
 * so without including it here every insert was silently failing and
 * the cron's skip-back density heuristic had no data to read.
 */
import { useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export type PlaybackEventType = "skip_back" | "skip_forward";

export interface UsePlaybackEventsResult {
  record: (eventType: PlaybackEventType, timestampSeconds: number) => void;
}

export function usePlaybackEvents(podcastId: string | null): UsePlaybackEventsResult {
  const { user } = useAuth();
  const record = useCallback(
    (eventType: PlaybackEventType, timestampSeconds: number) => {
      if (!podcastId || !user) return;
      void supabase
        .from("playback_events")
        .insert({
          user_id: user.id,
          podcast_id: podcastId,
          event_type: eventType,
          timestamp_seconds: Math.max(0, Math.round(timestampSeconds)),
        })
        .then(({ error }) => {
          if (error) {
            console.warn("[playback_events] insert failed:", error.message);
          }
        });
    },
    [podcastId, user],
  );

  return { record };
}
