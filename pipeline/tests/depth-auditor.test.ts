import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockStructured = vi.hoisted(() => vi.fn(() => ({ invoke: mockInvoke })));
const mockMakeOpenRouter = vi.hoisted(() =>
  vi.fn(() => ({ withStructuredOutput: mockStructured })),
);

vi.mock("../src/podcast_pipeline/providers/openrouter.js", () => ({
  makeOpenRouterModel: mockMakeOpenRouter,
}));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test";
  mockInvoke.mockReset();
});

describe("runAuditor", () => {
  it("returns claims ordered by severity", async () => {
    mockInvoke.mockResolvedValueOnce({
      audited: [
        { originalClaim: "X is vague", weakness: "specificity", drillQuestion: "What is X specifically?", originatingSourceIndexes: [0] },
        { originalClaim: "Y is undersourced", weakness: "sourcing", drillQuestion: "Where is Y documented?", originatingSourceIndexes: [] },
      ],
    });
    const { runAuditor } = await import(
      "../src/podcast_pipeline/nodes/research/depth/auditor.js"
    );
    const audited = await runAuditor({ sections: [], sources: [], claims: [] }, "chapter context");
    expect(audited).toHaveLength(2);
    expect(audited[0].weakness).toBe("specificity");
  });

  it("returns empty array on malformed JSON retry failure", async () => {
    mockInvoke.mockRejectedValue(new Error("bad json"));
    const { runAuditor } = await import(
      "../src/podcast_pipeline/nodes/research/depth/auditor.js"
    );
    const audited = await runAuditor({ sections: [], sources: [], claims: [] }, "ctx");
    expect(audited).toEqual([]);
  });

  it("returns empty array when auditor returns empty audited list", async () => {
    mockInvoke.mockResolvedValueOnce({ audited: [] });
    const { runAuditor } = await import(
      "../src/podcast_pipeline/nodes/research/depth/auditor.js"
    );
    const audited = await runAuditor({ sections: [], sources: [], claims: [] }, "ctx");
    expect(audited).toEqual([]);
  });
});
