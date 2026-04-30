/**
 * Background playback event handler. Registered via
 * TrackPlayer.registerPlaybackService in index.ts so the OS lock-screen,
 * Now Playing widget, and Bluetooth controls all dispatch into here.
 *
 * Without this service the lock-screen skip pills are visible but inert.
 */
import TrackPlayer, { Event } from "react-native-track-player";

const SKIP_INTERVAL_SECONDS = 10;

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    TrackPlayer.seekTo(position);
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async ({ interval }) => {
    const progress = await TrackPlayer.getProgress();
    const step = interval ?? SKIP_INTERVAL_SECONDS;
    const target = Math.min(
      progress.duration || progress.position + step,
      progress.position + step,
    );
    TrackPlayer.seekTo(target);
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async ({ interval }) => {
    const progress = await TrackPlayer.getProgress();
    const step = interval ?? SKIP_INTERVAL_SECONDS;
    TrackPlayer.seekTo(Math.max(0, progress.position - step));
  });
}
