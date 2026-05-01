/**
 * Voice picker metadata + bundled sample audio.
 * Samples are pre-rendered by pipeline/scripts/build-voice-samples.ts.
 * Re-run that script when this metadata or the script copy changes.
 */

export interface VoiceMeta {
  id: string;
  name: string;
  descriptor: string;
  sample: number; // require() module ID
}

export const VOICES: readonly VoiceMeta[] = [
  {
    id: "coral",
    name: "Coral",
    descriptor: "Warm, natural, easy to listen to.",
    sample: require("../../assets/voice-samples/coral.mp3"),
  },
  {
    id: "sage",
    name: "Sage",
    descriptor: "Thoughtful, contemplative.",
    sample: require("../../assets/voice-samples/sage.mp3"),
  },
  {
    id: "ash",
    name: "Ash",
    descriptor: "Calm, steady, low-key.",
    sample: require("../../assets/voice-samples/ash.mp3"),
  },
  {
    id: "ballad",
    name: "Ballad",
    descriptor: "Expressive, a little theatrical.",
    sample: require("../../assets/voice-samples/ballad.mp3"),
  },
];
