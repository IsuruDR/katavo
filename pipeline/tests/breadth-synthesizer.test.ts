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

describe("runBreadthSynthesizer", () => {
  it("returns document with sections, sources, claims", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [{ title: "Origins", content: "Bezzera filed in 1901." }],
      sources: [{ url: "https://a.com", title: "A" }],
      claims: [{ text: "Bezzera filed in 1901", sourceIndexes: [0] }],
      droppedQuestions: [],
    });
    const { runBreadthSynthesizer } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/synthesizer.js"
    );
    const doc = await runBreadthSynthesizer([], []);
    expect(doc.sections).toHaveLength(1);
    expect(doc.claims[0].sourceIndexes).toEqual([0]);
  });

  it("propagates droppedQuestions when model omits them", async () => {
    mockInvoke.mockResolvedValueOnce({
      sections: [],
      sources: [],
      claims: [],
    });
    const { runBreadthSynthesizer } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/synthesizer.js"
    );
    const doc = await runBreadthSynthesizer([], ["lost question"]);
    expect(doc.droppedQuestions).toEqual(["lost question"]);
  });

  it("retries once on synth failure", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("bad json"))
      .mockResolvedValueOnce({
        sections: [], sources: [], claims: [], droppedQuestions: [],
      });
    const { runBreadthSynthesizer } = await import(
      "../src/podcast_pipeline/nodes/research/breadth/synthesizer.js"
    );
    const doc = await runBreadthSynthesizer([], []);
    expect(doc).toBeDefined();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
