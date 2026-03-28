import { describe, it, expect, vi } from "vitest";

vi.mock("../src/podcast_pipeline/providers/ttsGoogle.js", () => ({
  GoogleWaveNetTTS: vi.fn().mockImplementation(() => ({
    synthesize: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
  })),
}));

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue(null),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://storage/audio.mp3" } }),
      }),
    },
  }),
}));

import { splitScriptSegments } from "../src/podcast_pipeline/nodes/audioProducer.js";

describe("splitScriptSegments", () => {
  it("should split script into text and ad segments", () => {
    const script =
      "[AD:PRE_ROLL]\n\n[CHAPTER: Intro]\nHello world\n\n[AD:MID_ROLL]\n\n[CHAPTER: Main]\nContent";
    const segments = splitScriptSegments(script);

    const adSegments = segments.filter((s) => s.type === "ad");
    const textSegments = segments.filter((s) => s.type === "text");

    expect(adSegments).toHaveLength(2);
    expect(textSegments).toHaveLength(2);
    expect(textSegments[0].content).toContain("Hello world");
  });
});
