import { describe, it, expect, vi } from "vitest";

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("../src/podcast_pipeline/providers/supabaseClient.js", () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation(() => ({
      update: mockUpdate,
      insert: mockInsert,
    })),
  }),
}));

// Mock sendPodcastNotification (direct in-process call, no HTTP fetch)
vi.mock("../src/routes/notifyComplete.js", () => ({
  sendPodcastNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock cover artwork rendering — exercising satori in unit tests is slow
// and the supabase mock doesn't stub `.storage`, so we just no-op it here.
vi.mock("../src/podcast_pipeline/nodes/coverArtwork.js", () => ({
  generateCoverArtwork: vi.fn().mockResolvedValue(Buffer.alloc(0)),
}));
import {
  metadataWriter,
  extractChapters,
  extractChapterTranscripts,
} from "../src/podcast_pipeline/nodes/metadataWriter.js";

describe("extractChapters", () => {
  it("should extract chapter markers from script", () => {
    const script =
      "[CHAPTER: The Quantum Threat]\nContent...\n[CHAPTER: Fighting Back]\nMore content...";
    const chapters = extractChapters(script, 600);

    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe("The Quantum Threat");
    expect(chapters[0].timestampSeconds).toBe(0);
  });
});

describe("metadataWriter", () => {
  it("should return complete status with chapter markers", async () => {
    const state = {
      podcastId: "test-123",
      userId: "user-456",
      topic: "quantum computing",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.85,
      researchIterations: 1,
      chapterResearchMap: null,
    };

    const result = await metadataWriter(state as any);

    expect(result.status).toBe("complete");
    expect(result.chapterMarkers!.length).toBeGreaterThan(0);
  });

  it("should include chapter_research_map in podcast update when present", async () => {
    vi.clearAllMocks();

    const chapterMap = {
      "Intro": { researchSections: [0], sourceIndexes: [0] },
    };

    const state = {
      podcastId: "test-456",
      userId: "user-789",
      topic: "AI safety",
      script: "[CHAPTER: Intro]\nHello world",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 300,
      researchDocument: { sections: [{ title: "Intro", content: "..." }] },
      sources: [{ url: "https://a.com", title: "A" }],
      credibilityScore: 0.9,
      researchIterations: 1,
      chapterResearchMap: chapterMap,
    };

    await metadataWriter(state as any);

    // Verify podcast update includes chapter_research_map
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_research_map: chapterMap,
      }),
    );
  });

  it("should persist rawResearchResponse on the research_contexts row", async () => {
    vi.clearAllMocks();

    const rawResponse = {
      id: "resp_xyz",
      status: "completed",
      output: [{ type: "message", content: [] }],
    };

    const state = {
      podcastId: "test-raw",
      userId: "user-raw",
      topic: "raw response test",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: { sections: [] },
      sources: [],
      rawResearchResponse: rawResponse,
      credibilityScore: 0.85,
      researchIterations: 1,
      chapterResearchMap: null,
    };

    await metadataWriter(state as any);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_response: rawResponse,
      }),
    );
  });

  it("should set raw_response to null when state is missing it", async () => {
    vi.clearAllMocks();

    const state = {
      podcastId: "test-no-raw",
      userId: "user-no-raw",
      topic: "test",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: {},
      sources: [],
      credibilityScore: null,
      researchIterations: 1,
      chapterResearchMap: null,
    };

    await metadataWriter(state as any);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_response: null,
      }),
    );
  });

  it("should set chapter_research_map to null in update when not provided", async () => {
    vi.clearAllMocks();

    const state = {
      podcastId: "test-789",
      userId: "user-012",
      topic: "climate",
      script: "[CHAPTER: Intro]\nHello",
      audioUrl: "https://storage/audio.mp3",
      durationSeconds: 600,
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.85,
      researchIterations: 1,
      chapterResearchMap: null,
    };

    await metadataWriter(state as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_research_map: null,
      }),
    );
  });
});

describe("extractChapterTranscripts", () => {
  it("splits script on chapter markers and returns title→text map", () => {
    const script = `Preamble before any marker.

[CHAPTER: Opening]
Hello world. This is the opening.

[CHAPTER: Middle]
Middle content here.

[CHAPTER: Closer]
Final thoughts.`;
    const out = extractChapterTranscripts(script);
    expect(Object.keys(out)).toEqual(["Opening", "Middle", "Closer"]);
    expect(out["Opening"]).toContain("Hello world");
    expect(out["Middle"]).toContain("Middle content here");
    expect(out["Closer"]).toContain("Final thoughts");
  });

  it("strips AD markers from chapter text", () => {
    const script = `[CHAPTER: A]
Some prose.
[AD:MID_ROLL]
More prose.`;
    const out = extractChapterTranscripts(script);
    expect(out["A"]).not.toContain("[AD:");
    expect(out["A"]).toContain("Some prose");
    expect(out["A"]).toContain("More prose");
  });

  it("returns empty object when no chapter markers present", () => {
    expect(extractChapterTranscripts("just text no markers")).toEqual({});
  });

  it("skips chapters with empty text", () => {
    const script = `[CHAPTER: Empty][CHAPTER: Real]
Content`;
    const out = extractChapterTranscripts(script);
    expect(out).toEqual({ Real: "Content" });
  });
});
