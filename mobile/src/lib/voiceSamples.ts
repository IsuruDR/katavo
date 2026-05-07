/**
 * Voice picker metadata + bundled sample audio.
 * Samples are pre-rendered by pipeline/scripts/build-voice-samples.ts.
 * Re-run that script when this metadata or the script copy changes.
 */

export interface VoiceMeta {
  id: string;        // Gemini voice name, capitalized (matches state.voice + DB)
  name: string;      // Display name in UI
  descriptor: string;
  sample: number;    // require() module ID
}

export const VOICES: readonly VoiceMeta[] = [
  {
    id: "Sulafat",
    name: "Sulafat",
    descriptor: "Warm, conversational. Like a friend who knows their stuff.",
    sample: require("../../assets/voice-samples/sulafat.mp3"),
  },
  {
    id: "Charon",
    name: "Charon",
    descriptor: "Substance-forward, clear, informed. No fluff.",
    sample: require("../../assets/voice-samples/charon.mp3"),
  },
  {
    id: "Sadaltager",
    name: "Sadaltager",
    descriptor: "Thoughtful, knowledgeable. The dinner-party historian.",
    sample: require("../../assets/voice-samples/sadaltager.mp3"),
  },
  {
    id: "Achird",
    name: "Achird",
    descriptor: "Casual, friendly. Coffee-shop conversation tempo.",
    sample: require("../../assets/voice-samples/achird.mp3"),
  },
];
