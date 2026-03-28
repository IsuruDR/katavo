import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TTSProvider } from "../src/podcast_pipeline/providers/ttsBase.js";

vi.mock("@google-cloud/text-to-speech", () => {
  const mockSynthesize = vi.fn();
  return {
    default: {
      TextToSpeechClient: vi.fn().mockImplementation(() => ({
        synthesizeSpeech: mockSynthesize,
      })),
    },
    TextToSpeechClient: vi.fn().mockImplementation(() => ({
      synthesizeSpeech: mockSynthesize,
    })),
    __mockSynthesize: mockSynthesize,
  };
});

import { GoogleWaveNetTTS } from "../src/podcast_pipeline/providers/ttsGoogle.js";
import * as ttsModule from "@google-cloud/text-to-speech";

describe("GoogleWaveNetTTS", () => {
  it("should implement TTSProvider interface", () => {
    const provider: TTSProvider = new GoogleWaveNetTTS();
    expect(provider.synthesize).toBeDefined();
  });

  it("should return audio bytes from synthesize", async () => {
    const mockSynthesize = (ttsModule as any).__mockSynthesize;
    mockSynthesize.mockResolvedValue([
      { audioContent: Buffer.from("fake-audio-bytes") },
    ]);

    const provider = new GoogleWaveNetTTS();
    const audioBytes = await provider.synthesize("Hello, this is a test.");

    expect(audioBytes).toEqual(Buffer.from("fake-audio-bytes"));
    expect(mockSynthesize).toHaveBeenCalledOnce();
  });
});
