import { describe, it, expect } from "vitest";
import { qualityGate } from "../src/podcast_pipeline/nodes/qualityGate.js";

describe("qualityGate", () => {
  it("should pass when score meets threshold and sources are sufficient", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      researchBrief: '{"keyQuestions":["What is PQC?","When is Q-day?"]}',
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("scripting");
    expect(result.shouldRetry).toBe(false);
    expect(result.needsDisclaimer).toBe(false);
    expect(result.researchIterations).toBe(1);
  });

  it("should retry when sources are below minimum threshold", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
      ],
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.credibilityReport).toContain("Insufficient sources");
  });

  it("should retry when credibility score is below threshold", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [] },
      researchBrief: '{"keyQuestions":["q1","q2","q3","q4","q5"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.credibilityReport).toContain("below threshold");
  });

  it("should proceed with disclaimer after max retries even if quality is low", () => {
    const state = {
      credibilityScore: 0.3,
      researchIterations: 2,
      sources: [{ url: "https://a.com", title: "A" }],
      researchDocument: { sections: [] },
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(false);
    expect(result.needsDisclaimer).toBe(true);
    expect(result.status).toBe("scripting");
    expect(result.researchIterations).toBe(3);
  });

  it("should fail (not proceed) when zero research material remains after max retries", () => {
    // Reproduces the silent-12-second-podcast bug: deepResearch returned
    // status="failed" three times, leaving sources=[] and sections=[]. The
    // pipeline must not proceed-with-disclaimer when there is literally
    // nothing to write about.
    const state = {
      status: "failed",
      errorMessage: "Deep research failed: rate_limit",
      credibilityScore: null,
      researchIterations: 2,
      sources: [],
      researchDocument: {},
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("failed");
    expect(result.shouldRetry).toBe(false);
    expect(result.needsDisclaimer).toBeFalsy();
    expect(result.errorMessage).toBeTruthy();
  });

  it("should fail when researchDocument has empty sections array and zero sources after max retries", () => {
    const state = {
      credibilityScore: 0,
      researchIterations: 2,
      sources: [],
      researchDocument: { sections: [] },
      researchBrief: '{"keyQuestions":["q1"]}',
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBeTruthy();
  });

  it("should handle malformed researchBrief gracefully", () => {
    const state = {
      credibilityScore: 0.9,
      researchIterations: 0,
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      researchBrief: "not valid json",
    };

    const result = qualityGate(state as any);

    // Should still pass since sources and score are good
    expect(result.status).toBe("scripting");
    expect(result.shouldRetry).toBe(false);
  });
});
