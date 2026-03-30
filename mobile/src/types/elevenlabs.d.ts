// Type declarations for @11labs/react-native
// This package will be installed when ElevenLabs publishes their React Native SDK.
declare module "@11labs/react-native" {
  interface ConversationSession {
    endSession(): Promise<void>;
    sendUserInput?(text: string): void;
  }

  interface StartSessionOptions {
    agentId: string;
    overrides?: {
      agent?: {
        prompt?: { prompt: string };
        firstMessage?: string;
      };
    };
    onConnect?: (info: { conversationId: string }) => void;
    onDisconnect?: () => void;
    onMessage?: (msg: { message: string; source: "user" | "ai" }) => void;
    onError?: (error: Error) => void;
  }

  export class Conversation {
    static startSession(options: StartSessionOptions): Promise<ConversationSession>;
  }
}
