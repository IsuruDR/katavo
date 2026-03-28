// mobile/src/hooks/usePlayer.ts
import { useState, useEffect, useCallback } from "react";
import TrackPlayer, { useProgress, State, usePlaybackState } from "react-native-track-player";
import { setupPlayer, loadTrack } from "../services/player";

export function usePlayer(podcastId: string, audioUrl: string, title: string) {
  const [ready, setReady] = useState(false);
  const progress = useProgress();
  const playbackState = usePlaybackState();

  useEffect(() => {
    (async () => {
      await setupPlayer();
      await loadTrack(podcastId, audioUrl, title);
      setReady(true);
    })();

    return () => { TrackPlayer.reset(); };
  }, [podcastId, audioUrl, title]);

  const play = useCallback(async () => { await TrackPlayer.play(); }, []);
  const pause = useCallback(async () => { await TrackPlayer.pause(); }, []);
  const seekTo = useCallback(async (seconds: number) => { await TrackPlayer.seekTo(seconds); }, []);

  const isPlaying = playbackState.state === State.Playing;

  return { ready, isPlaying, progress, play, pause, seekTo };
}
