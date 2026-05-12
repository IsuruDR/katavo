import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const mockModCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
      moderations: { create: mockModCreate },
    })),
    __mockCreate: mockCreate,
    __mockModCreate: mockModCreate,
  };
});

import { scriptWriter, parseChapterResearchMap } from "../src/podcast_pipeline/nodes/scriptWriter.js";

describe("parseChapterResearchMap", () => {
  it("should extract chapter_research_map from fenced JSON block", () => {
    const text = `[CHAPTER: Intro]
Some script content...

\`\`\`chapter_research_map
{
  "Intro": { "researchSections": [0], "sourceIndexes": [0, 1] },
  "Deep Dive": { "researchSections": [1, 2], "sourceIndexes": [2] }
}
\`\`\``;

    const result = parseChapterResearchMap(text, 3, 3);

    expect(result).toEqual({
      Intro: { researchSections: [0], sourceIndexes: [0, 1] },
      "Deep Dive": { researchSections: [1, 2], sourceIndexes: [2] },
    });
  });

  it("should clamp out-of-bounds indexes", () => {
    const text = `script
\`\`\`chapter_research_map
{
  "Ch1": { "researchSections": [0, 10], "sourceIndexes": [0, 99] }
}
\`\`\``;

    const result = parseChapterResearchMap(text, 2, 3);

    expect(result).toEqual({
      Ch1: { researchSections: [0, 1], sourceIndexes: [0, 2] },
    });
  });

  it("should return null for malformed JSON", () => {
    const text = `script
\`\`\`chapter_research_map
not valid json
\`\`\``;

    const result = parseChapterResearchMap(text, 2, 3);
    expect(result).toBeNull();
  });

  it("should return null when no chapter_research_map block exists", () => {
    const text = "[CHAPTER: Intro]\nJust a script, no map block.";
    const result = parseChapterResearchMap(text, 2, 3);
    expect(result).toBeNull();
  });
});

describe("scriptWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should produce a script and chapterResearchMap", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    const scriptWithMap = `[CHAPTER: The Quantum Threat]
Imagine a computer so powerful...

[CHAPTER: Fighting Back]
But researchers aren't idle...

\`\`\`chapter_research_map
{
  "The Quantum Threat": { "researchSections": [0], "sourceIndexes": [0, 1] },
  "Fighting Back": { "researchSections": [1], "sourceIndexes": [1, 2] }
}
\`\`\``;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: scriptWithMap } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: {
        sections: [
          { title: "Threat", content: "..." },
          { title: "Defense", content: "..." },
        ],
      },
      sources: [
        { url: "https://a.com", title: "A" },
        { url: "https://b.com", title: "B" },
        { url: "https://c.com", title: "C" },
      ],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toContain("[CHAPTER: The Quantum Threat]");
    // Script should not contain the map block
    expect(result.script).not.toContain("chapter_research_map");
    expect(result.chapterResearchMap).toEqual({
      "The Quantum Threat": { researchSections: [0], sourceIndexes: [0, 1] },
      "Fighting Back": { researchSections: [1], sourceIndexes: [1, 2] },
    });
    expect(result.status).toBe("scripting");
  });

  it("should return null chapterResearchMap when LLM omits the block", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: Intro]\nJust a plain script." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: false }],
    });

    const state = {
      researchDocument: { sections: [] },
      sources: [],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.script).toBeDefined();
    expect(result.chapterResearchMap).toBeNull();
  });

  it("should fail when content is flagged by moderation", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Flagged content..." } }],
    });

    mockModCreate.mockResolvedValue({
      results: [{ flagged: true }],
    });

    const state = {
      researchDocument: { sections: [] },
      sources: [],
      needsDisclaimer: false,
    };

    const result = await scriptWriter(state as any);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("moderation");
  });
});

describe("scriptWriter expansion mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses SCRIPT_WRITER_EXPANSION_PROMPT when parentPodcastId set", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: A]\nExpansion content." } }],
    });
    mockModCreate.mockResolvedValue({ results: [{ flagged: false }] });

    await scriptWriter({
      podcastId: "p1",
      userId: "u1",
      parentPodcastId: "parent",
      sourceChapterTitle: "Why fast",
      parentChapterTranscript: "We discussed X.",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
    } as any);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain("CONTINUATION");
    expect(systemPrompt).toContain("Source chapter title: Why fast");
    expect(systemPrompt).toContain("We discussed X");
  });

  it("uses SCRIPT_WRITER_PROMPT when parentPodcastId null", async () => {
    const { __mockCreate: mockCreate, __mockModCreate: mockModCreate } =
      (await import("openai")) as any;

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[CHAPTER: A]\nNormal." } }],
    });
    mockModCreate.mockResolvedValue({ results: [{ flagged: false }] });

    await scriptWriter({
      podcastId: "p1",
      researchDocument: { sections: [{ title: "T", content: "C" }] },
      sources: [],
      parentPodcastId: null,
    } as any);

    const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).not.toContain("CONTINUATION");
  });
});
