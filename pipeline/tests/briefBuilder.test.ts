import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

vi.mock("../src/podcast_pipeline/nodes/persistStatus.js", () => ({
  persistStatus: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("briefBuilder", () => {
  it("should produce a structured brief from topic and answers", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "Impact of quantum computing on cryptography",
      angle: "beginner-friendly",
      depth: "intermediate",
      keyQuestions: [
        "What is quantum computing?",
        "How does it threaten encryption?",
        "What is post-quantum cryptography?",
      ],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");

    const state = {
      podcastId: "p1",
      topic: "quantum computing and cryptography",
      clarifyingAnswers: [{ q: "What angle?", a: "beginner friendly" }],
    };

    const result = await briefBuilder(state as any);

    expect(result.researchBrief).toBeDefined();
    expect(result.researchBrief!.toLowerCase()).toContain("quantum");
    // Now stored as JSON string, parseable
    const parsed = JSON.parse(result.researchBrief!);
    expect(parsed.keyQuestions.length).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe("researching");
  });
});

describe("briefBuilder expansion mode", () => {
  it("uses BRIEF_BUILDER_EXPANSION_PROMPT when parentPodcastId is set", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "deep dive on X",
      angle: "extend parent's coverage",
      depth: "expert",
      keyQuestions: ["q1", "q2", "q3"],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "AI environmental impact",
      parentPodcastId: "parent-id",
      sourceChapterTitle: "Data center energy",
      parentResearchDigest: "Section A: covered. Section B: covered.",
      parentChapterTranscript: "We talked about X and Y.",
    } as any);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const messages = mockInvoke.mock.calls[0][0];
    expect(messages[0].content).toContain("CONTINUATION");
    expect(messages[1].content).toContain("Parent topic: AI environmental impact");
    expect(messages[1].content).toContain("Source chapter title: Data center energy");
    expect(messages[1].content).toContain("Section A: covered");
    expect(messages[1].content).toContain("We talked about X and Y");
  });

  it("uses BRIEF_BUILDER_PROMPT when parentPodcastId is null", async () => {
    mockInvoke.mockResolvedValueOnce({
      scope: "x",
      angle: "y",
      depth: "z",
      keyQuestions: ["q1", "q2", "q3"],
    });

    const { briefBuilder } = await import("../src/podcast_pipeline/nodes/briefBuilder.js");
    await briefBuilder({
      podcastId: "p1",
      userId: "u1",
      topic: "Octopus cognition",
      clarifyingAnswers: [{ q: "How technical?", a: "beginner" }],
      parentPodcastId: null,
    } as any);

    const messages = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1][0];
    expect(messages[0].content).not.toContain("CONTINUATION");
    expect(messages[1].content).toContain("Topic: Octopus cognition");
  });
});
