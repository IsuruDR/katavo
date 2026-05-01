import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

// Mock the langfuse client before importing the module under test
vi.mock("../src/podcast_pipeline/providers/langfuseClient.js", () => {
  const mockCreate = vi.fn();
  return {
    getObservedOpenAI: vi.fn().mockReturnValue({
      audio: {
        speech: {
          create: mockCreate,
        },
      },
    }),
    __mockCreate: mockCreate,
  };
});

import { OpenAITTS } from "../src/podcast_pipeline/providers/ttsOpenai.js";
import * as langfuseClient from "../src/podcast_pipeline/providers/langfuseClient.js";

describe("OpenAITTS", () => {
  const mockCreate = (langfuseClient as any).__mockCreate;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should implement TTSProvider interface", () => {
    const provider: TTSProvider = new OpenAITTS();
    expect(provider.synthesize).toBeDefined();
  });

  it("should return audio bytes from synthesize", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]); // fake MP3 header
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    const result = await provider.synthesize("Hello, this is a test.");

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini-tts",
        voice: "ballad",
        input: "Hello, this is a test.",
        response_format: "mp3",
      }),
    );
  });

  it("should use custom voice when provided", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]);
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    await provider.synthesize("Test", "alloy");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );
  });

  it("should include voice instructions in the API call", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]);
    mockCreate.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(fakeAudioBytes.buffer),
    });

    const provider = new OpenAITTS();
    await provider.synthesize("Test");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining("coffee table"),
      }),
    );
  });
});
