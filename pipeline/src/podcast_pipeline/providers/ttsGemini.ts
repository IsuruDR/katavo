import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getGeminiClient } from "./gemini.js";
import {
  GEMINI_TTS_MODEL,
  GEMINI_VOICES,
  DEFAULT_GEMINI_VOICE,
} from "../config.js";
import type { TTSProvider } from "./ttsBase.js";

const VOICE_SET = new Set<string>(GEMINI_VOICES);

function resolveVoice(input?: string): string {
  if (input && VOICE_SET.has(input)) return input;
  if (input)
    console.warn(
      `[GeminiTTS] unknown voice "${input}" — falling back to ${DEFAULT_GEMINI_VOICE}`,
    );
  return DEFAULT_GEMINI_VOICE;
}

export class GeminiTTS implements TTSProvider {
  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const client = getGeminiClient();
    const voice = resolveVoice(voiceName);

    const response = await client.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: text,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    } as any);

    const inlineData =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((response as any).candidates?.[0]?.content?.parts ?? []).find(
        (p: any) => p.inlineData?.data,
      )?.inlineData;

    if (!inlineData?.data) {
      throw new Error("GeminiTTS: response contained no audio inlineData");
    }

    const pcmBytes = Buffer.from(inlineData.data, "base64");

    const dir = mkdtempSync(join(tmpdir(), "gemini-tts-"));
    try {
      const pcmPath = join(dir, "audio.pcm");
      const mp3Path = join(dir, "audio.mp3");
      writeFileSync(pcmPath, pcmBytes);
      execSync(
        `ffmpeg -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}" -y`,
        { stdio: "pipe" },
      );
      return Buffer.from(readFileSync(mp3Path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
