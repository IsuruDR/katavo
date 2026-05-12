/**
 * Fire-and-forget inserts to playback_events. Used by the player to log
 * skip-back / skip-forward taps, which feed the re-engagement push
 * chapter-selection heuristic (skip-back density = "user wanted to
 * re-hear this chapter").
 *
 * Failures are silently swallowed — losing one data point is acceptable;
 * blocking the UI for a telemetry call is not.
 */
import { useCallback } from "react";
import { supabase } from "../lib/supabase";

export type PlaybackEventType = "skip_back" | "skip_forward";

export interface UsePlaybackEventsResult {
  record: (eventType: PlaybackEventType, timestampSeconds: number) => void;
}

export function usePlaybackEvents(podcastId: string | null): UsePlaybackEventsResult {
  const record = useCallback(
    (eventType: PlaybackEventType, timestampSeconds: number) => {
      if (!podcastId) return;
      void supabase
        .from("playback_events")
        .insert({
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
    [podcastId],
  );

  return { record };
}
