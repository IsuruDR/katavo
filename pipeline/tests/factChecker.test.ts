import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { factChecker } from "../src/podcast_pipeline/nodes/factChecker.js";

describe("factChecker", () => {
  it("should produce a credibility assessment", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        claims: [
          { claim: "Quantum computers can break RSA", confidence: 0.9, sourcesCount: 3, issues: "" },
        ],
        overallScore: 0.85,
        summary: "Research is well-sourced",
        gaps: [],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchDocument: { sections: [{ title: "Test", content: "Content" }] },
      sources: [{ url: "https://test.com", title: "Test", snippet: "..." }],
    };

    const result = await factChecker(state as any);

    expect(result.credibilityScore).toBe(0.85);
    expect(result.credibilityReport).toBeDefined();
  });
});
