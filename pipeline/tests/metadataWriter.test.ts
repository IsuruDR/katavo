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

// Mock global fetch for notification
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

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
    };

    const result = await metadataWriter(state as any);

    expect(result.status).toBe("complete");
    expect(result.chapterMarkers!.length).toBeGreaterThan(0);
  });
});
