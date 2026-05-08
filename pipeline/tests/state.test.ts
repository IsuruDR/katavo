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
      tier: "free",
    });

    expect(state.podcastId).toBe("test-123");
    expect(state.researchIterations).toBe(0);
    expect(state.status).toBe("queued");
    expect(state.credibilityScore).toBeNull();
    expect(state.chapterResearchMap).toBeNull();
  });

  it("should not have researchPlan field", () => {
    const state = makeInitialState({});
    expect("researchPlan" in state).toBe(false);
  });

  it("should accept chapterResearchMap", () => {
    const map = {
      "The Quantum Threat": { researchSections: [0, 1], sourceIndexes: [0, 1, 2] },
    };
    const state = makeInitialState({ chapterResearchMap: map });
    expect(state.chapterResearchMap).toEqual(map);
  });
});
