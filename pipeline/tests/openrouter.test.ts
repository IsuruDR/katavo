import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatOpenAI = vi.hoisted(() =>
  vi.fn().mockImplementation((cfg: any) => ({ _cfg: cfg, invoke: vi.fn() })),
);

vi.mock("@langchain/openai", () => ({ ChatOpenAI: mockChatOpenAI }));

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
});

describe("makeOpenRouterModel", () => {
  it("returns a ChatOpenAI configured for OpenRouter base URL with required temperature", async () => {
    const { makeOpenRouterModel } = await import("../src/podcast_pipeline/providers/openrouter.js");
    const m = makeOpenRouterModel("anthropic/claude-sonnet-4.6", { temperature: 0.0 }) as any;
    expect(m._cfg.modelName).toBe("anthropic/claude-sonnet-4.6");
    expect(m._cfg.apiKey).toBe("test-key");
    expect(m._cfg.configuration.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(m._cfg.temperature).toBe(0.0);
  });

  it("throws helpfully when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { makeOpenRouterModel } = await import("../src/podcast_pipeline/providers/openrouter.js");
    expect(() => makeOpenRouterModel("anthropic/claude-haiku-4.5", { temperature: 0.4 })).toThrow(/OPENROUTER_API_KEY/);
  });
});
