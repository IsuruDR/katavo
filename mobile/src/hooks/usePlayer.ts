// mobile/src/hooks/usePlayer.ts
/**
 * usePlayer — transport controls + live progress for whatever's currently
 * loaded in TrackPlayer. Loading is owned by PlayingPodcastContext now,
 * so this hook is purely a view into the singleton player state.
 */
import { useCallback } from "react";
import TrackPlayer, {
  State,
  usePlaybackState,
  useProgress,
} from "react-native-track-player";

const SKIP_INTERVAL_SECONDS = 10;

export function usePlayer() {
  const progress = useProgress();
  const playbackState = usePlaybackState();

  const play = useCallback(async () => {
    await TrackPlayer.play();
  }, []);

  const pause = useCallback(async () => {
    await TrackPlayer.pause();
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
    await TrackPlayer.seekTo(seconds);
  }, []);

  const skipBack = useCallback(async () => {
    const { position } = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, position - SKIP_INTERVAL_SECONDS));
  }, []);

  const skipForward = useCallback(async () => {
    const { position, duration } = await TrackPlayer.getProgress();
    const target = position + SKIP_INTERVAL_SECONDS;
    await TrackPlayer.seekTo(duration > 0 ? Math.min(duration, target) : target);
  }, []);

  const isPlaying = playbackState.state === State.Playing;

  return {
    isPlaying,
    progress,
    play,
    pause,
    seekTo,
    skipBack,
    skipForward,
  };
}
