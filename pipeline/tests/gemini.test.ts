import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation((cfg: any) => ({ _cfg: cfg })),
);

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  mockGoogleGenAI.mockClear();
  vi.resetModules();
  const { resetGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
  resetGeminiClient();
});

describe("getGeminiClient", () => {
  it("returns a GoogleGenAI configured with the env apiKey", async () => {
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    const client = getGeminiClient() as any;
    expect(client._cfg.apiKey).toBe("test-key");
  });

  it("caches the client instance across calls", async () => {
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    const a = getGeminiClient();
    const b = getGeminiClient();
    expect(a).toBe(b);
  });

  it("throws when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const { getGeminiClient } = await import("../src/podcast_pipeline/providers/gemini.js");
    expect(() => getGeminiClient()).toThrow(/GEMINI_API_KEY/);
  });
});
