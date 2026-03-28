// mobile/src/services/player.ts
import TrackPlayer, { Capability, Event } from "react-native-track-player";

let isSetup = false;

export async function setupPlayer() {
  if (isSetup) return;
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SeekTo,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
  });
  isSetup = true;
}

export async function loadTrack(id: string, url: string, title: string) {
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id,
    url,
    title,
    artist: "AI Podcast",
  });
}
