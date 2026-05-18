import { describe, it, expect } from "vitest";
import { evaluateQualityGate } from "../src/podcast_pipeline/nodes/research/depth/qualityGate.js";

describe("evaluateQualityGate", () => {
  it.each([
    ["free", 0, false],
    ["free", 2, false],
    ["free", 3, true],
    ["free", 5, true],
    ["plus", 0, false],
    ["plus", 1, false],
    ["plus", 2, true],
    ["pro", 0, false],
    ["pro", 1, true],
    ["pro", 5, true],
    ["unknown_tier", 3, true], // resolveTier defaults to free
  ])("tier=%s findings=%i → fire=%s", (tier, findings, expected) => {
    expect(evaluateQualityGate(tier, findings).fire).toBe(expected);
  });
});
