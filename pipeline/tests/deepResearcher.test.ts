import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { deepResearcher } from "../src/podcast_pipeline/nodes/deepResearcher.js";

describe("deepResearcher", () => {
  it("should produce a structured research document", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        sections: [
          { title: "Introduction", content: "Quantum computing threatens..." },
          { title: "Current State", content: "NIST has standardized..." },
        ],
        sources: [
          { url: "https://nist.gov/pqc", title: "NIST PQC", snippet: "..." },
        ],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchPlan: '{"queries": ["quantum crypto"], "angles": ["technical"]}',
      trustedSourceUrls: [],
      tier: "free",
    };

    const result = await deepResearcher(state as any);

    expect(result.researchDocument).toBeDefined();
    expect(result.sources).toBeDefined();
    expect(result.status).toBe("fact_checking");
  });
});
