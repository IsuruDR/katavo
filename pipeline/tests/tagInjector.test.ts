import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
);

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  mockGenerateContent.mockReset();
  vi.resetModules();
  const { resetGeminiClient } = await import(
    "../src/podcast_pipeline/providers/gemini.js"
  );
  resetGeminiClient();
});

const SCRIPT_WITH_2_CHAPTERS = `[CHAPTER: Origins]
Bezzera filed his patent in 1901. The first commercial machine shipped that year.

[CHAPTER: Modern era]
The Faema E61 in 1961 changed everything.`;

describe("tagInjector", () => {
  it("returns tagged script preserving CHAPTER markers", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: `[CHAPTER: Origins]
[curious] Bezzera filed his patent in 1901. The first commercial machine shipped that year.

[CHAPTER: Modern era]
[thoughtful] The Faema E61 in 1961 changed everything.`,
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toContain("[curious]");
    expect(result.taggedScript).toContain("[thoughtful]");
    expect((result.taggedScript!.match(/\[CHAPTER:/g) ?? []).length).toBe(2);
  });

  it("falls through to original script on Gemini error AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockRejectedValueOnce(new Error("API failure"));
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/SDK error/), expect.anything());
    warnSpy.mockRestore();
  });

  it("falls through when output is empty AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockResolvedValueOnce({ text: "   " });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/empty model output/));
    warnSpy.mockRestore();
  });

  it("falls through when chapter-marker count differs AND logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGenerateContent.mockResolvedValueOnce({
      text: `[CHAPTER: Origins]
[curious] Bezzera filed his patent in 1901.`,
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    const result = await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    expect(result.taggedScript).toBe(SCRIPT_WITH_2_CHAPTERS);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/chapter-marker count mismatch/));
    warnSpy.mockRestore();
  });

  it("includes AUDIO_TAGS values in the prompt", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: SCRIPT_WITH_2_CHAPTERS,
    });
    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({ script: SCRIPT_WITH_2_CHAPTERS } as any);
    const callArg = mockGenerateContent.mock.calls[0][0];
    const prompt = String(callArg.contents);
    expect(prompt).toContain("[laughs]");
    expect(prompt).toContain("[whispers]");
  });

  it("injects voice personality summary into the prompt for the chosen voice", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: "Charon",
    } as any);

    const callArg = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    const prompt = String(callArg.contents);
    expect(prompt).toContain("Voice context:");
    expect(prompt).toContain("Substance-forward");
    expect(prompt).toContain("Gemini's Charon voice");
  });

  it("falls back to Sulafat when voice is null", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: null,
    } as any);

    const callArg = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    const prompt = String(callArg.contents);
    expect(prompt).toContain("friendly-knowledgeable-friend");
    expect(prompt).toContain("Gemini's Sulafat voice");
  });

  it("preserves the hard-constraint rules in the simplified prompt", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "[CHAPTER: A]\nTagged." });

    const { tagInjector } = await import("../src/podcast_pipeline/nodes/tagInjector.js");
    await tagInjector({
      script: "[CHAPTER: A]\nSome prose.",
      voice: "Sulafat",
    } as any);

    const callArg = mockGenerateContent.mock.calls[mockGenerateContent.mock.calls.length - 1][0];
    const prompt = String(callArg.contents);
    expect(prompt).toContain("Place each tag immediately before");
    expect(prompt).toContain("Preserve all [CHAPTER: ...] markers verbatim");
    expect(prompt).toContain("[AD:PRE_ROLL]");
    expect(prompt).toContain("[AD:MID_ROLL]");
    expect(prompt).toMatch(/One tag per sentence maximum/);
  });
});
