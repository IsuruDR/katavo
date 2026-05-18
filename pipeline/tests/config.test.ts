import { describe, it, expect } from "vitest";
import { TIER_CONFIG, resolveTier } from "../src/podcast_pipeline/config.js";

describe("TIER_CONFIG", () => {
  it("defines free, plus, pro tiers", () => {
    expect(Object.keys(TIER_CONFIG).sort()).toEqual(["free", "plus", "pro"].sort());
  });

  it("breadth question count scales by tier", () => {
    expect(TIER_CONFIG.free.breadthQuestions).toBe(5);
    expect(TIER_CONFIG.plus.breadthQuestions).toBe(6);
    expect(TIER_CONFIG.pro.breadthQuestions).toBe(8);
  });

  it("search budgets match legacy RESEARCH_BUDGETS to avoid regression", () => {
    expect(TIER_CONFIG.free.searchBudget).toEqual({ maxSearches: 2, maxReflections: 1 });
    expect(TIER_CONFIG.plus.searchBudget).toEqual({ maxSearches: 3, maxReflections: 2 });
    expect(TIER_CONFIG.pro.searchBudget).toEqual({ maxSearches: 5, maxReflections: 2 });
  });

  it("gate fire thresholds invert with tier (free is most permissive)", () => {
    expect(TIER_CONFIG.free.gateFireThreshold).toBe(3);
    expect(TIER_CONFIG.plus.gateFireThreshold).toBe(2);
    expect(TIER_CONFIG.pro.gateFireThreshold).toBe(1);
  });

  it("R2 cap grows with tier", () => {
    expect(TIER_CONFIG.free.maxR2Subagents).toBe(3);
    expect(TIER_CONFIG.plus.maxR2Subagents).toBe(4);
    expect(TIER_CONFIG.pro.maxR2Subagents).toBe(5);
  });
});

describe("resolveTier", () => {
  it("returns the tier when valid", () => {
    expect(resolveTier("plus")).toBe("plus");
    expect(resolveTier("pro")).toBe("pro");
    expect(resolveTier("free")).toBe("free");
  });

  it("defaults to free for unknown values", () => {
    expect(resolveTier(undefined)).toBe("free");
    expect(resolveTier("")).toBe("free");
    expect(resolveTier("enterprise")).toBe("free");
  });
});
