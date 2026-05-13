import { describe, it, expect } from "vitest";
import {
  getVoicePersonality,
  VOICE_PERSONALITIES,
  type VoicePersonality,
} from "../src/podcast_pipeline/voicePersonality.js";
import { GEMINI_VOICES } from "../src/podcast_pipeline/config.js";

describe("getVoicePersonality", () => {
  it("returns the matching personality when voice is a known GeminiVoice", () => {
    expect(getVoicePersonality("Sulafat").summary).toContain("Warm");
    expect(getVoicePersonality("Charon").summary).toContain("Substance");
    expect(getVoicePersonality("Sadaltager").summary).toContain("historian");
    expect(getVoicePersonality("Achird").summary).toContain("Casual");
  });

  it("falls back to Sulafat when voice is null", () => {
    expect(getVoicePersonality(null)).toBe(VOICE_PERSONALITIES.Sulafat);
  });

  it("falls back to Sulafat when voice is undefined", () => {
    expect(getVoicePersonality(undefined)).toBe(VOICE_PERSONALITIES.Sulafat);
  });

  it("falls back to Sulafat when voice doesn't match a known voice", () => {
    expect(getVoicePersonality("Unknown")).toBe(VOICE_PERSONALITIES.Sulafat);
    expect(getVoicePersonality("")).toBe(VOICE_PERSONALITIES.Sulafat);
  });
});

describe("VOICE_PERSONALITIES", () => {
  it("covers every voice in GEMINI_VOICES with all three fields populated", () => {
    for (const voice of GEMINI_VOICES) {
      const personality: VoicePersonality = VOICE_PERSONALITIES[voice];
      expect(personality.summary.length, `${voice}.summary`).toBeGreaterThan(20);
      expect(personality.briefAngle.length, `${voice}.briefAngle`).toBeGreaterThan(20);
      expect(personality.scriptStyle.length, `${voice}.scriptStyle`).toBeGreaterThan(100);
    }
  });

  it("voices have meaningfully different summaries", () => {
    const summaries = Object.values(VOICE_PERSONALITIES).map((p) => p.summary);
    const unique = new Set(summaries);
    expect(unique.size).toBe(summaries.length);
  });
});
