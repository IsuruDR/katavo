/**
 * POST /api/end-deep-dive
 *
 * Ends an active QA session. Fetches authoritative duration from ElevenLabs,
 * updates the session record, and deducts deep dive minutes with CAS.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { sessionId, elevenlabsSessionId? }
 * Response: { durationSeconds, minutesUsed, estimatedCost, deepDiveMinutesRemaining }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";

const COST_PER_MINUTE = 0.1;

const route = new Hono();

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
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.metadata?.duration_seconds ?? data.duration_seconds ?? null;
  } catch {
    return null;
  }
}

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const { sessionId, elevenlabsSessionId } = await c.req.json();

    if (!sessionId) {
      return c.json({ error: "sessionId is required" }, 400);
    }

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Verify session
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .select("id, user_id, started_at, ended_at")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session || session.user_id !== user.id) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (session.ended_at) {
      return c.json({ error: "Session already ended" }, 409);
    }

    // Get authoritative duration
    let durationSeconds: number;
    if (elevenlabsSessionId) {
      const elevenLabsDuration =
        await getElevenLabsSessionDuration(elevenlabsSessionId);
      if (elevenLabsDuration !== null) {
        durationSeconds = elevenLabsDuration;
      } else {
        durationSeconds = Math.round(
          (Date.now() - new Date(session.started_at).getTime()) / 1000,
        );
      }
    } else {
      durationSeconds = Math.round(
        (Date.now() - new Date(session.started_at).getTime()) / 1000,
      );
    }

    const minutesUsed = Math.ceil(durationSeconds / 60);
    const estimatedCost = minutesUsed * COST_PER_MINUTE;

    // Update session
    await serviceClient
      .from("qa_sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        estimated_cost: estimatedCost,
        elevenlabs_session_id: elevenlabsSessionId ?? null,
      })
      .eq("id", sessionId);

    // Deduct minutes with CAS
    const { data: currentSub } = await serviceClient
      .from("subscriptions")
      .select("deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    const currentMinutes = currentSub?.deep_dive_minutes_remaining ?? 0;
    const newMinutes = Math.max(0, currentMinutes - minutesUsed);

    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ deep_dive_minutes_remaining: newMinutes })
      .eq("user_id", user.id)
      .eq("deep_dive_minutes_remaining", currentMinutes)
      .select("deep_dive_minutes_remaining")
      .single();

    if (deductError || !updatedSub) {
      // Retry once
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
        return c.json(
          {
            error:
              "Failed to deduct minutes due to concurrent update. Please try again.",
          },
          409,
        );
      }

      return c.json({
        durationSeconds,
        minutesUsed,
        estimatedCost,
        deepDiveMinutesRemaining: retryUpdated.deep_dive_minutes_remaining,
      });
    }

    return c.json({
      durationSeconds,
      minutesUsed,
      estimatedCost,
      deepDiveMinutesRemaining: updatedSub.deep_dive_minutes_remaining,
    });
  } catch {
    return c.json({ error: "Failed to end deep dive" }, 500);
  }
});

export { route as endDeepDiveRoute };
