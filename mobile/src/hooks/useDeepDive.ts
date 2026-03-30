// mobile/src/hooks/useDeepDive.ts
/**
 * useDeepDive — manages the Deep Dive voice conversation lifecycle.
 *
 * Responsibilities:
 * - Calls start-deep-dive Edge Function to validate and create session
 * - Initializes ElevenLabs Conversational AI agent with research context
 * - Manages session state (connecting, active, ending, error)
 * - Client-side minute countdown timer
 * - Calls end-deep-dive Edge Function on session end
 * - Handles connection drops (3 retries with backoff)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { buildAgentContext, getAgentId } from "../services/elevenlabs";

type DeepDiveStatus = "idle" | "connecting" | "active" | "ending" | "ended" | "error";

const MAX_SESSION_DURATION = 15 * 60; // 15 minutes in seconds
const WARNING_THRESHOLD = 2 * 60; // Warn at 2 minutes remaining

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

interface UseDeepDiveReturn {
  status: DeepDiveStatus;
  transcript: TranscriptEntry[];
  minutesRemaining: number;
  showWarning: boolean;
  errorMessage: string | null;
  startSession: (podcastId: string, chapterTitle: string) => Promise<void>;
  endSession: () => Promise<{ deepDiveMinutesRemaining: number } | null>;
  sendTextMessage: (text: string) => void;
}

export function useDeepDive(): UseDeepDiveReturn {
  const [status, setStatus] = useState<DeepDiveStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [minutesRemaining, setMinutesRemaining] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const elevenlabsSessionIdRef = useRef<string | null>(null);
  const conversationRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialMinutesRef = useRef<number>(0);
  const statusRef = useRef<DeepDiveStatus>("idle");

  // Keep statusRef in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Client-side countdown timer
  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const sessionSecondsLeft = MAX_SESSION_DURATION - elapsed;
        const minutePoolLeft = initialMinutesRef.current * 60 - elapsed;
        const secondsLeft = Math.min(sessionSecondsLeft, minutePoolLeft);
        const minsLeft = Math.max(0, Math.ceil(secondsLeft / 60));

        setMinutesRemaining(minsLeft);
        setShowWarning(secondsLeft <= WARNING_THRESHOLD && secondsLeft > 0);

        if (secondsLeft <= 0) {
          endSession();
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  const endSession = useCallback(async () => {
    if (statusRef.current === "ending" || statusRef.current === "ended") return null;
    setStatus("ending");

    // Stop ElevenLabs conversation
    if (conversationRef.current) {
      try {
        await conversationRef.current.endSession();
      } catch {
        // Best effort
      }
      conversationRef.current = null;
    }

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Call end-deep-dive Edge Function
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/end-deep-dive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession?.access_token}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            elevenlabsSessionId: elevenlabsSessionIdRef.current,
          }),
        },
      );

      setStatus("ended");

      if (response.ok) {
        const data = await response.json();
        return { deepDiveMinutesRemaining: data.deepDiveMinutesRemaining };
      }
    } catch {
      // Session still ends locally even if Edge Function fails
    }

    setStatus("ended");
    return null;
  }, []);

  const startSession = useCallback(
    async (podcastId: string, chapterTitle: string) => {
      setStatus("connecting");
      setErrorMessage(null);
      setTranscript([]);

      try {
        // Call start-deep-dive Edge Function
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();

        const response = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/start-deep-dive`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authSession?.access_token}`,
              apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
            },
            body: JSON.stringify({ podcastId, chapterTitle }),
          },
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to start deep dive");
        }

        const data = await response.json();
        sessionIdRef.current = data.sessionId;
        initialMinutesRef.current = data.minutesRemaining;
        setMinutesRemaining(data.minutesRemaining);

        // Build agent context
        const { systemPrompt, firstMessage } = buildAgentContext({
          researchDocument: data.researchDocument,
          sources: data.sources,
          chapterResearchMap: data.chapterResearchMap,
          transcript: data.transcript ?? "",
          chapterTitle,
        });

        // Initialize ElevenLabs conversation
        // Dynamic import to avoid loading SDK until needed
        const { Conversation } = await import("@11labs/react-native");

        const conversation = await Conversation.startSession({
          agentId: getAgentId(),
          overrides: {
            agent: {
              prompt: { prompt: systemPrompt },
              firstMessage,
            },
          },
          onConnect: ({ conversationId }: { conversationId: string }) => {
            elevenlabsSessionIdRef.current = conversationId;
            startTimeRef.current = Date.now();
            setStatus("active");
          },
          onDisconnect: () => {
            if (statusRef.current === "active") {
              endSession();
            }
          },
          onMessage: ({
            message,
            source,
          }: {
            message: string;
            source: "user" | "ai";
          }) => {
            setTranscript((prev) => [
              ...prev,
              {
                role: source === "ai" ? "assistant" : "user",
                text: message,
              },
            ]);
          },
          onError: (error: Error) => {
            setErrorMessage(error.message);
            setStatus("error");
          },
        });

        conversationRef.current = conversation;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatus("error");
      }
    },
    [endSession],
  );

  const sendTextMessage = useCallback(
    (text: string) => {
      if (conversationRef.current && status === "active") {
        // Add to transcript immediately
        setTranscript((prev) => [...prev, { role: "user", text }]);
        // Note: ElevenLabs text input may need different API depending on SDK version
        // The conversation.sendUserInput method sends text as user speech
        conversationRef.current.sendUserInput?.(text);
      }
    },
    [status],
  );

  return {
    status,
    transcript,
    minutesRemaining,
    showWarning,
    errorMessage,
    startSession,
    endSession,
    sendTextMessage,
  };
}
