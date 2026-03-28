import { describe, it, expect, vi } from "vitest";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn(),
  })),
}));

import { researchPlanner } from "../src/podcast_pipeline/nodes/researchPlanner.js";

describe("researchPlanner", () => {
  it("should create a plan from brief", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        queries: ["quantum computing cryptography impact 2026", "post-quantum encryption standards"],
        angles: ["technical", "policy implications"],
        prioritySources: ["academic papers", "NIST publications"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchBrief: '{"scope": "quantum crypto", "keyQuestions": ["what?"]}',
      credibilityReport: "",
      researchIterations: 0,
    };

    const result = await researchPlanner(state as any);

    expect(result.researchPlan).toBeDefined();
    const plan = JSON.parse(result.researchPlan!);
    expect(plan.queries.length).toBeGreaterThanOrEqual(2);
  });

  it("should include retry context when iterations > 0", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const mockInvoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        queries: ["specific gap query"],
        angles: ["fill gaps"],
        prioritySources: ["academic"],
      }),
    });
    (ChatOpenAI as any).mockImplementation(() => ({ invoke: mockInvoke }));

    const state = {
      researchBrief: '{"scope": "test"}',
      credibilityReport: "Gap: missing data on X",
      researchIterations: 1,
    };

    const result = await researchPlanner(state as any);

    const callArgs = mockInvoke.mock.calls[0][0];
    const userMessage = callArgs[1].content;
    expect(userMessage).toContain("Gap: missing data on X");
  });
});
