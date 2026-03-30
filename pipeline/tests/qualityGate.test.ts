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
