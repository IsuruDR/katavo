/**
 * Google Cloud WaveNet TTS provider.
 */

import textToSpeech from "@google-cloud/text-to-speech";
import type { TTSProvider } from "./ttsBase.js";

const DEFAULT_VOICE = "en-US-Neural2-D";
const DEFAULT_SPEAKING_RATE = 1.0;

export class GoogleWaveNetTTS implements TTSProvider {
  private client: InstanceType<typeof textToSpeech.TextToSpeechClient>;
  private voiceName: string;
  private speakingRate: number;

  constructor(voiceName = DEFAULT_VOICE, speakingRate = DEFAULT_SPEAKING_RATE) {
    this.client = new textToSpeech.TextToSpeechClient();
    this.voiceName = voiceName;
    this.speakingRate = speakingRate;
  }

  async synthesize(text: string, voiceName?: string): Promise<Buffer> {
    const voice = voiceName ?? this.voiceName;

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "en-US",
        name: voice,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: this.speakingRate,
      },
    });

    return Buffer.from(response.audioContent as Uint8Array);
  }
}
