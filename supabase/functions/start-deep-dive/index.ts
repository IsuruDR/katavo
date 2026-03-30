// supabase/functions/start-deep-dive/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

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

    const { podcastId, chapterTitle } = await req.json();

    if (!podcastId || !chapterTitle) {
      return new Response(
        JSON.stringify({ error: "podcastId and chapterTitle are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check subscription has deep dive minutes
    const { data: subscription, error: subError } = await serviceClient
      .from("subscriptions")
      .select("tier, deep_dive_minutes_remaining")
      .eq("user_id", user.id)
      .single();

    if (subError || !subscription) {
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (subscription.tier === "free") {
      return new Response(
        JSON.stringify({ error: "Deep Dive requires a Plus or Pro subscription" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (subscription.deep_dive_minutes_remaining <= 0) {
      return new Response(
        JSON.stringify({ error: "No deep dive minutes remaining. Resets on next renewal." }),
        { status: 402, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Check no concurrent active session
    const { count: activeSessions } = await serviceClient
      .from("qa_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("ended_at", null);

    if ((activeSessions ?? 0) > 0) {
      return new Response(
        JSON.stringify({ error: "You already have an active deep dive session" }),
        { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // Verify podcast ownership and fetch research context
    const { data: podcast, error: podcastError } = await serviceClient
      .from("podcasts")
      .select("id, user_id, topic, transcript, chapter_research_map")
      .eq("id", podcastId)
      .single();

    if (podcastError || !podcast || podcast.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Podcast not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const { data: researchContext } = await serviceClient
      .from("research_contexts")
      .select("research_document, sources")
      .eq("podcast_id", podcastId)
      .single();

    // Create session record
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
      return new Response(
        JSON.stringify({ error: "Failed to create session" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        minutesRemaining: subscription.deep_dive_minutes_remaining,
        researchDocument: researchContext?.research_document ?? {},
        sources: researchContext?.sources ?? [],
        chapterResearchMap: podcast.chapter_research_map,
        transcript: podcast.transcript,
        chapterTitle,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to start deep dive" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
