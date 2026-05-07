import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGoogleGenAI = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
);
const mockExecSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn(() => "/tmp/tts-test"));
const mockRmSync = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({ GoogleGenAI: mockGoogleGenAI }));
vi.mock("node:child_process", () => ({ execSync: mockExecSync }));
vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  mkdtempSync: mockMkdtempSync,
  rmSync: mockRmSync,
}));

beforeEach(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  vi.clearAllMocks();
  vi.resetModules();
  const { resetGeminiClient } = await import(
    "../src/podcast_pipeline/providers/gemini.js"
  );
  resetGeminiClient();
});

describe("GeminiTTS.synthesize", () => {
  it("calls Gemini with correct voice + decodes base64 + invokes ffmpeg", async () => {
    const fakeBase64 = Buffer.from([0x01, 0x02, 0x03]).toString("base64");
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        { content: { parts: [{ inlineData: { data: fakeBase64 } }] } },
      ],
    });
    mockReadFileSync.mockReturnValueOnce(Buffer.from([0xff, 0xfb])); // fake mp3 header

    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    const buf = await tts.synthesize("hello world", "Charon");

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      "Charon",
    );
    expect(callArg.config.responseModalities).toEqual(["AUDIO"]);
    expect(buf).toBeInstanceOf(Buffer);
    const ffArg = mockExecSync.mock.calls[0][0] as string;
    expect(ffArg).toContain("-f s16le");
    expect(ffArg).toContain("-ar 24000");
    expect(ffArg).toContain("libmp3lame");
  });

  it("falls back to default voice when voiceName is undefined or invalid", async () => {
    const fakeBase64 = Buffer.from([0x01]).toString("base64");
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { data: fakeBase64 } }] } }],
    });
    mockReadFileSync.mockReturnValueOnce(Buffer.from([0xff]));

    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    await tts.synthesize("hi", "ballad"); // legacy OpenAI voice — should fall back
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      "Sulafat",
    );
  });

  it("throws if Gemini returns no audio", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: "oops" }] } }],
    });
    const { GeminiTTS } = await import("../src/podcast_pipeline/providers/ttsGemini.js");
    const tts = new GeminiTTS();
    await expect(tts.synthesize("hi", "Sulafat")).rejects.toThrow(/no audio/i);
  });
});
