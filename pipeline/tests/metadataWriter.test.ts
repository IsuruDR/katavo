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
import {
  metadataWriter,
  extractChapters,
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
