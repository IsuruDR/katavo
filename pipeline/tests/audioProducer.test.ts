import { describe, it, expect, vi } from "vitest";

vi.mock("../src/podcast_pipeline/providers/ttsGemini.js", () => ({
  GeminiTTS: vi.fn().mockImplementation(() => ({
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

// Mock execSync so stitchAudio tests don't require ffmpeg to be installed
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("0.5"),
}));

// Mock fs so readFileSync returns a small buffer (simulates concat output)
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string) => {
      // Return the concat output file as a fake buffer; other reads (e.g. ad files) throw
      if (String(path).endsWith("output.mp3")) return Buffer.from("fake-concat-output");
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    writeFileSync: vi.fn(),
    mkdtempSync: vi.fn().mockReturnValue("/tmp/podcast-audio-test"),
    rmSync: vi.fn(),
  };
});

import { splitScriptSegments, stitchAudio } from "../src/podcast_pipeline/nodes/audioProducer.js";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

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

describe("stitchAudio voice forwarding", () => {
  it("forwards named voice to tts.synthesize", async () => {
    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };

    const segments = [{ type: "text" as const, content: "Hello world" }];
    await stitchAudio(segments, tts, "ballad");

    expect(synthesize).toHaveBeenCalledWith("Hello world", "ballad");
  });

  it("passes undefined to tts.synthesize when voice is null", async () => {
    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };

    const segments = [{ type: "text" as const, content: "Hello world" }];
    await stitchAudio(segments, tts, null);

    expect(synthesize).toHaveBeenCalledWith("Hello world", undefined);
  });
});
