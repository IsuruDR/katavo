// supabase/functions/end-deep-dive/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;

const COST_PER_MINUTE = 0.10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

/**
 * Fetch session duration from ElevenLabs API (server-authoritative).
 * Returns duration in seconds, or null if not available.
 */
async function getElevenLabsSessionDuration(
  elevenlabsSessionId: string,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${elevenlabsSessionId}`,
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    // ElevenLabs returns duration_seconds in the conversation metadata
    return data.metadata?.duration_seconds ?? data.duration_seconds ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const { sessionId, elevenlabsSessionId } = await req.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "sessionId is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify session belongs to user and is still active
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .select("id, user_id, started_at, ended_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session || session.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Session not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (session.ended_at) {
      return new Response(
        JSON.stringify({ error: "Session already ended" }),
        { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Get authoritative duration from ElevenLabs
    let durationSeconds: number;

    if (elevenlabsSessionId) {
      const elevenLabsDuration =
        await getElevenLabsSessionDuration(elevenlabsSessionId);
      if (elevenLabsDuration !== null) {
        durationSeconds = elevenLabsDuration;
      } else {
        // Fallback: compute from start time
        durationSeconds = Math.round(
          (Date.now() - new Date(session.started_at).getTime()) / 1000,
        );
      }
    } else {
      // No ElevenLabs session ID — compute from start time
      durationSeconds = Math.round(
        (Date.now() - new Date(session.started_at).getTime()) / 1000,
      );
    }

    // Round up to nearest minute for billing
    const minutesUsed = Math.ceil(durationSeconds / 60);
    const estimatedCost = minutesUsed * COST_PER_MINUTE;

    // Update session record
    await serviceClient
      .from("qa_sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        estimated_cost: estimatedCost,
        elevenlabs_session_id: elevenlabsSessionId ?? null,
      })
      .eq("id", sessionId);

    // Deduct minutes with optimistic concurrency check
    const { data: currentSub } = await serviceClient
      .from("subscriptions")
      .select("deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    const currentMinutes = currentSub?.deep_dive_minutes_remaining ?? 0;
    const newMinutes = Math.max(0, currentMinutes - minutesUsed);

    // Optimistic concurrency: only update if deep_dive_minutes_remaining hasn't changed
    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ deep_dive_minutes_remaining: newMinutes })
      .eq("user_id", user.id)
      .eq("deep_dive_minutes_remaining", currentMinutes)
      .select("deep_dive_minutes_remaining")
      .single();

    if (deductError || !updatedSub) {
      // Concurrent modification detected — re-read and retry once
      const { data: retrySub } = await serviceClient
        .from("subscriptions")
        .select("deep_dive_minutes_remaining")
        .eq("user_id", user.id)
        .single();

      const retryMinutes = retrySub?.deep_dive_minutes_remaining ?? 0;
      const retryNewMinutes = Math.max(0, retryMinutes - minutesUsed);

      const { data: retryUpdated, error: retryError } = await serviceClient
        .from("subscriptions")
        .update({ deep_dive_minutes_remaining: retryNewMinutes })
        .eq("user_id", user.id)
        .eq("deep_dive_minutes_remaining", retryMinutes)
        .select("deep_dive_minutes_remaining")
        .single();

      if (retryError || !retryUpdated) {
        return new Response(
          JSON.stringify({ error: "Failed to deduct minutes due to concurrent update. Please try again." }),
          { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }

      return new Response(
        JSON.stringify({
          durationSeconds,
          minutesUsed,
          estimatedCost,
          deepDiveMinutesRemaining: retryUpdated.deep_dive_minutes_remaining,
        }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    return new Response(
      JSON.stringify({
        durationSeconds,
        minutesUsed,
        estimatedCost,
        deepDiveMinutesRemaining: updatedSub.deep_dive_minutes_remaining,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to end deep dive" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
