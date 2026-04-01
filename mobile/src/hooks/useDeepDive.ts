// mobile/src/hooks/useDeepDive.ts
/**
 * useDeepDive — manages the Deep Dive voice conversation lifecycle.
 *
 * Responsibilities:
 * - Calls start-deep-dive Edge Function to validate and create session
 * - Uses @elevenlabs/react-native useConversation hook for voice AI
 * - Manages session state (connecting, active, ending, error)
 * - Client-side minute countdown timer
 * - Calls end-deep-dive Edge Function on session end
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react-native";
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
  isSpeaking: boolean;
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
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialMinutesRef = useRef<number>(0);
  const statusRef = useRef<DeepDiveStatus>("idle");
  const contextualUpdateRef = useRef<string | null>(null);

  // Keep statusRef in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      elevenlabsSessionIdRef.current = conversationId;
      startTimeRef.current = Date.now();
      setStatus("active");

      // Send contextual update once connected
      if (contextualUpdateRef.current) {
        conversation.sendContextualUpdate(contextualUpdateRef.current);
        contextualUpdateRef.current = null;
      }
    },
    onDisconnect: () => {
      if (statusRef.current === "active") {
        endSession();
      }
    },
    onMessage: (message) => {
      setTranscript((prev) => [
        ...prev,
        {
          role: message.source === "ai" ? "assistant" : "user",
          text: message.message,
        },
      ]);
    },
    onError: (message) => {
      setErrorMessage(message);
      setStatus("error");
    },
  });

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
    try {
      await conversation.endSession();
    } catch {
      // Best effort
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
  }, [conversation]);

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
        const { contextualUpdate } = buildAgentContext({
          researchDocument: data.researchDocument,
          sources: data.sources,
          chapterResearchMap: data.chapterResearchMap,
          transcript: data.transcript ?? "",
          chapterTitle,
        });

        // Store contextual update to send after connection is established
        contextualUpdateRef.current = contextualUpdate;

        // Start ElevenLabs conversation session
        conversation.startSession({
          agentId: getAgentId(),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(message);
        setStatus("error");
      }
    },
    [conversation, endSession],
  );

  const sendTextMessage = useCallback(
    (text: string) => {
      if (status === "active") {
        // Add to transcript immediately
        setTranscript((prev) => [...prev, { role: "user", text }]);
        // Send as contextual update (text-based input for voice agent)
        conversation.sendContextualUpdate(text);
        // Signal user activity
        conversation.sendUserActivity();
      }
    },
    [status, conversation],
  );

  return {
    status,
    transcript,
    minutesRemaining,
    showWarning,
    errorMessage,
    isSpeaking: conversation.isSpeaking,
    startSession,
    endSession,
    sendTextMessage,
  };
}
