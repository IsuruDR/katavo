import { describe, it, expect } from "vitest";
import { PipelineState, makeInitialState } from "../src/podcast_pipeline/state.js";
import type { PipelineStateType } from "../src/podcast_pipeline/state.js";

describe("PipelineState", () => {
  it("should create initial state with required fields and defaults", () => {
    const state = makeInitialState({
      podcastId: "test-123",
      userId: "user-456",
      topic: "quantum computing",
      clarifyingAnswers: [{ q: "What angle?", a: "beginner friendly" }],
      hasAds: true,
      trustedSourceUrls: [],
      tier: "free",
    });

    expect(state.podcastId).toBe("test-123");
    expect(state.researchIterations).toBe(0);
    expect(state.status).toBe("queued");
    expect(state.credibilityScore).toBeNull();
  });

  it("should accept all pipeline fields", () => {
    const state = makeInitialState({
      podcastId: "test-123",
      userId: "user-456",
      topic: "AI",
      clarifyingAnswers: [],
      hasAds: false,
      trustedSourceUrls: [],
      tier: "pro",
      researchBrief: "brief",
      researchPlan: "plan",
      researchDocument: { sections: [] },
      sources: [],
      credibilityScore: 0.9,
      credibilityReport: "all good",
      researchIterations: 2,
      script: "Hello world",
      adMarkers: { preRoll: 0, midRoll: 120 },
      audioUrl: "https://example.com/audio.mp3",
      transcript: "Hello world",
      chapterMarkers: [{ timestampSeconds: 0, title: "Intro" }],
      durationSeconds: 600,
      status: "complete",
      errorMessage: null,
    });

    expect(state.researchIterations).toBe(2);
  });
});
