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
const execSyncMock = vi.hoisted(() => vi.fn().mockReturnValue("0.5"));
vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
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

import {
  splitScriptSegments,
  splitTextIntoChapterChunks,
  splitOnSentences,
  stitchAudio,
} from "../src/podcast_pipeline/nodes/audioProducer.js";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

describe("splitOnSentences", () => {
  it("keeps short text as one chunk", () => {
    const out = splitOnSentences("One. Two. Three.", 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("One. Two. Three.");
  });

  it("splits on sentence boundaries when over the word limit", () => {
    // Each sentence is 4 words; limit 5 → first chunk holds one sentence,
    // adding the second would push to 8 (> 5) so it starts a new chunk.
    const text = "Alpha bravo charlie delta. Echo foxtrot golf hotel. India juliet kilo lima.";
    const out = splitOnSentences(text, 5);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/Alpha bravo charlie delta/);
    expect(out[1]).toMatch(/Echo foxtrot golf hotel/);
    expect(out[2]).toMatch(/India juliet kilo lima/);
  });

  it("ships an oversized single sentence rather than mid-cutting", () => {
    const huge = "this is a single very long sentence with way too many words for the limit but no terminator until here.";
    const out = splitOnSentences(huge, 5);
    // No mid-sentence split — one chunk with the whole sentence.
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(huge);
  });
});

describe("splitTextIntoChapterChunks", () => {
  it("returns one chunk per chapter", () => {
    const text = "[CHAPTER: One]\nAlpha bravo.\n\n[CHAPTER: Two]\nCharlie delta.";
    const out = splitTextIntoChapterChunks(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("Alpha bravo.");
    expect(out[1]).toBe("Charlie delta.");
  });

  it("treats text with no chapter markers as a single chunk", () => {
    const out = splitTextIntoChapterChunks("Just some plain text without markers.");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("Just some plain text without markers.");
  });

  it("sub-splits a chapter that exceeds the word limit", () => {
    // 6 sentences × 4 words = 24 words in one chapter; limit 8 → expect ~3 chunks
    const big = Array.from({ length: 6 }, (_, i) => `Sentence ${i} word word.`).join(" ");
    const text = `[CHAPTER: Long]\n${big}`;
    const out = splitTextIntoChapterChunks(text, 8);
    expect(out.length).toBeGreaterThan(1);
    // Every chunk should respect the word ceiling (the oversized-single-sentence
    // case isn't triggered here — every sentence is 4 words).
    for (const chunk of out) {
      const words = chunk.trim().split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(8);
    }
  });

  it("skips empty pieces between adjacent chapter markers", () => {
    const text = "[CHAPTER: One][CHAPTER: Two]\nReal content here.";
    const out = splitTextIntoChapterChunks(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("Real content here.");
  });
});

describe("splitScriptSegments", () => {
  it("emits one text segment per chapter between ad markers", () => {
    const script =
      "[AD:PRE_ROLL]\n\n[CHAPTER: Intro]\nHello world\n\n[AD:MID_ROLL]\n\n[CHAPTER: Main]\nContent";
    const segments = splitScriptSegments(script);

    const adSegments = segments.filter((s) => s.type === "ad");
    const textSegments = segments.filter((s) => s.type === "text");

    expect(adSegments).toHaveLength(2);
    expect(textSegments).toHaveLength(2);
    expect(textSegments[0].content).toContain("Hello world");
    expect(textSegments[1].content).toContain("Content");
  });

  it("emits one text segment per chapter when multiple chapters share an ad-bounded region", () => {
    const script =
      "[AD:PRE_ROLL]\n\n[CHAPTER: One]\nFirst chapter text.\n\n[CHAPTER: Two]\nSecond chapter text.\n\n[CHAPTER: Three]\nThird chapter text.";
    const segments = splitScriptSegments(script);

    const textSegments = segments.filter((s) => s.type === "text");
    expect(textSegments).toHaveLength(3);
    expect(textSegments[0].content).toBe("First chapter text.");
    expect(textSegments[1].content).toBe("Second chapter text.");
    expect(textSegments[2].content).toBe("Third chapter text.");
  });

  it("preserves ordering — ads interleave with chapters at their script positions", () => {
    const script =
      "[AD:PRE_ROLL]\n\n[CHAPTER: A]\nA text\n\n[CHAPTER: B]\nB text\n\n[AD:MID_ROLL]\n\n[CHAPTER: C]\nC text";
    const segments = splitScriptSegments(script);

    expect(segments.map((s) => (s.type === "ad" ? `ad:${s.adType}` : `text:${s.content}`))).toEqual([
      "ad:pre_roll",
      "text:A text",
      "text:B text",
      "ad:mid_roll",
      "text:C text",
    ]);
  });
});

describe("stitchAudio voice forwarding", () => {
  it("forwards named voice to tts.synthesize", async () => {
    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };

    const segments = [{ type: "text" as const, content: "Hello world" }];
    await stitchAudio(segments, tts, "Sulafat");

    expect(synthesize).toHaveBeenCalledWith("Hello world", "Sulafat");
  });

  it("passes undefined to tts.synthesize when voice is null", async () => {
    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };

    const segments = [{ type: "text" as const, content: "Hello world" }];
    await stitchAudio(segments, tts, null);

    expect(synthesize).toHaveBeenCalledWith("Hello world", undefined);
  });
});

describe("stitchAudio parallel synthesis", () => {
  it("synthesizes every text segment exactly once and preserves ordering", async () => {
    const calls: string[] = [];
    const synthesize = vi.fn().mockImplementation(async (text: string) => {
      calls.push(text);
      return Buffer.from(`audio-${text}`);
    });
    const tts: TTSProvider = { synthesize };

    const segments = [
      { type: "text" as const, content: "Alpha" },
      { type: "text" as const, content: "Bravo" },
      { type: "text" as const, content: "Charlie" },
    ];
    await stitchAudio(segments, tts);

    expect(synthesize).toHaveBeenCalledTimes(3);
    expect(calls.sort()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });
});

describe("stitchAudio concat command", () => {
  it("uses libmp3lame re-encode instead of -c copy", async () => {
    execSyncMock.mockClear();
    execSyncMock.mockReturnValueOnce(Buffer.from("")); // ffmpeg concat
    execSyncMock.mockReturnValueOnce("123.4"); // ffprobe duration

    const synthesize = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    const tts: TTSProvider = { synthesize };

    const segments = [{ type: "text" as const, content: "Hello" }];
    await stitchAudio(segments, tts);

    // First execSync call is the concat command.
    const concatCmd = String(execSyncMock.mock.calls[0][0]);
    expect(concatCmd).toContain("-f concat");
    expect(concatCmd).toContain("-c:a libmp3lame");
    expect(concatCmd).toContain("-qscale:a 2");
    expect(concatCmd).not.toContain("-c copy");
  });
});
