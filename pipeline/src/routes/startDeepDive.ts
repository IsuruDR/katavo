/**
 * POST /api/start-deep-dive
 *
 * Validates subscription, checks for active sessions, creates a QA session,
 * and returns research context for the ElevenLabs voice agent.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { podcastId, chapterTitle }
 * Response: { sessionId, minutesRemaining, researchDocument, sources, chapterResearchMap, transcript, chapterTitle }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";

const route = new Hono();

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const { podcastId, chapterTitle } = await c.req.json();

    if (!podcastId || !chapterTitle) {
      return c.json(
        { error: "podcastId and chapterTitle are required" },
        400,
      );
    }

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check subscription
    const { data: subscription, error: subError } = await serviceClient
      .from("subscriptions")
      .select("tier, deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    if (subError || !subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    if (subscription.tier === "free") {
      return c.json(
        { error: "Deep Dive requires a Plus or Pro subscription" },
        403,
      );
    }

    if (subscription.deep_dive_minutes_remaining <= 0) {
      return c.json(
        { error: "No deep dive minutes remaining. Resets on next renewal." },
        402,
      );
    }

    // Check no concurrent active session
    const { count: activeSessions } = await serviceClient
      .from("qa_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("ended_at", null);

    if ((activeSessions ?? 0) > 0) {
      return c.json(
        { error: "You already have an active deep dive session" },
        409,
      );
    }

    // Verify podcast ownership and fetch context
    const { data: podcast, error: podcastError } = await serviceClient
      .from("podcasts")
      .select("id, user_id, topic, transcript, chapter_research_map")
      .eq("id", podcastId)
      .single();

    if (podcastError || !podcast || podcast.user_id !== user.id) {
      return c.json({ error: "Podcast not found" }, 404);
    }

    const { data: researchContext } = await serviceClient
      .from("research_contexts")
      .select("research_document, sources")
      .eq("podcast_id", podcastId)
      .single();

    // Create session
    const { data: session, error: sessionError } = await serviceClient
      .from("qa_sessions")
      .insert({
        user_id: user.id,
        podcast_id: podcastId,
        chapter_title: chapterTitle,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessionError) {
      if (sessionError.code === "23505") {
        return c.json(
          { error: "You already have an active deep dive session" },
          409,
        );
      }
      return c.json({ error: "Failed to create session" }, 500);
    }

    return c.json({
      sessionId: session.id,
      minutesRemaining: subscription.deep_dive_minutes_remaining,
      researchDocument: researchContext?.research_document ?? {},
      sources: researchContext?.sources ?? [],
      chapterResearchMap: podcast.chapter_research_map,
      transcript: podcast.transcript,
      chapterTitle,
    });
  } catch {
    return c.json({ error: "Failed to start deep dive" }, 500);
  }
});

export { route as startDeepDiveRoute };
