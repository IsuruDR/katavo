// mobile/src/services/player.ts
import TrackPlayer, { Capability } from "react-native-track-player";

let isSetup = false;

const SKIP_INTERVAL_SECONDS = 10;

export async function setupPlayer() {
  if (isSetup) return;
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SeekTo,
      Capability.JumpForward,
      Capability.JumpBackward,
    ],
    compactCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.JumpBackward,
      Capability.JumpForward,
    ],
    forwardJumpInterval: SKIP_INTERVAL_SECONDS,
    backwardJumpInterval: SKIP_INTERVAL_SECONDS,
  });
  isSetup = true;
}

export async function loadTrack(
  id: string,
  url: string,
  title: string,
  artwork?: string | null,
) {
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id,
    url,
    title,
    artist: "Katavo",
    ...(artwork ? { artwork } : {}),
  });
}
