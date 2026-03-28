import { describe, it, expect } from "vitest";
import { qualityGate } from "../src/podcast_pipeline/nodes/qualityGate.js";

describe("qualityGate", () => {
  it("should pass when score is above threshold", () => {
    const state = {
      credibilityScore: 0.85,
      researchIterations: 0,
    };

    const result = qualityGate(state as any);

    expect(result.status).toBe("scripting");
    expect(result.researchIterations).toBe(1);
  });

  it("should retry when score is below threshold", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 0,
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(true);
    expect(result.researchIterations).toBe(1);
  });

  it("should proceed with disclaimer after max retries", () => {
    const state = {
      credibilityScore: 0.5,
      researchIterations: 2,
    };

    const result = qualityGate(state as any);

    expect(result.shouldRetry).toBe(false);
    expect(result.status).toBe("scripting");
    expect(result.needsDisclaimer).toBe(true);
  });
});
