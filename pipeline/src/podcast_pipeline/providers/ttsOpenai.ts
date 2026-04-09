/**
 * OpenAI gpt-4o-mini-tts provider.
 * Uses the Langfuse-observed OpenAI client for automatic cost tracking.
 */

import { getObservedOpenAI } from "./langfuseClient.js";
import type { TTSProvider } from "./ttsBase.js";
import { TTS_VOICE, TTS_VOICE_INSTRUCTIONS } from "../config.js";

export class OpenAITTS implements TTSProvider {
  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const openai = getObservedOpenAI();
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voiceName ?? TTS_VOICE,
      input: text,
      instructions: TTS_VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
