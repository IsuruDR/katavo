/**
 * Abstract TTS provider interface — swap implementations without rewriting nodes.
 */
export interface TTSProvider {
  synthesize(text: string, voiceName?: string): Promise<Buffer>;
}
