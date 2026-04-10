/**
 * POST /api/submit-podcast
 *
 * Validates credits, deducts one credit (CAS), creates podcast record,
 * enqueues pipeline run via job manager.
 *
 * Key difference from Edge Function: no LangGraph HTTP dispatch.
 * Instead calls jobManager.enqueue() for in-process pipeline execution.
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { topic, clarifyingAnswers?, trustedSourceId? }
 * Response: { podcast_id, status: "queued" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";
import type { JobManager } from "../jobs/jobManager.js";

const route = new Hono();

/**
 * Must be called once at startup to inject the job manager dependency.
 * This avoids circular imports between routes and the job manager.
 */
let jobManager: JobManager;
export function setJobManager(jm: JobManager): void {
  jobManager = jm;
}

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const topic = body.topic;
    const clarifyingAnswers = body.clarifyingAnswers ?? body.clarifying_answers ?? [];
    const trustedSourceId = body.trustedSourceId ?? body.trusted_source_id;

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check subscription exists
    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subscription) {
      return c.json(
        { error: "No credits remaining. Purchase more credits to continue." },
        402,
      );
    }

    // Check concurrent generation limit
    const tierLimits: Record<string, number> = { free: 1, plus: 2, pro: 3 };
    const maxConcurrent = tierLimits[subscription.tier] || 1;

    const { count } = await serviceClient
      .from("podcasts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "researching", "fact_checking", "scripting", "generating_audio"]);

    if ((count || 0) >= maxConcurrent) {
      return c.json(
        {
          error: `Maximum ${maxConcurrent} concurrent generations allowed. Please wait for current podcasts to finish.`,
        },
        429,
      );
    }

    const hasAds = subscription.tier === "free";

    // CAS credit deduction
    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ credits_remaining: subscription.credits_remaining - 1 })
      .eq("user_id", user.id)
      .eq("credits_remaining", subscription.credits_remaining)
      .gt("credits_remaining", 0)
      .select("credits_remaining")
      .single();

    if (deductError && deductError.code !== "PGRST116") {
      throw deductError;
    }

    if (!updatedSub) {
      const { data: currentSub } = await serviceClient
        .from("subscriptions")
        .select("credits_remaining")
        .eq("user_id", user.id)
        .single();

      if (!currentSub || currentSub.credits_remaining <= 0) {
        return c.json(
          { error: "No credits remaining. Purchase more credits to continue." },
          402,
        );
      }

      return c.json({ error: "Credit deduction conflict. Please retry." }, 409);
    }

    // Create podcast record
    const { data: podcast, error: insertError } = await serviceClient
      .from("podcasts")
      .insert({
        user_id: user.id,
        topic,
        clarifying_answers: clarifyingAnswers || [],
        status: "queued",
        has_ads: hasAds,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Record credit transaction
    await serviceClient.from("credit_transactions").insert({
      user_id: user.id,
      type: "deduction",
      amount: -1,
      podcast_id: podcast.id,
    });

    // Resolve trusted source URLs
    let trustedSourceUrls: string[] = [];
    if (trustedSourceId && subscription.tier === "pro") {
      const { data: sources } = await serviceClient
        .from("trusted_sources")
        .select("urls")
        .eq("id", trustedSourceId)
        .eq("user_id", user.id)
        .single();
      if (sources) {
        trustedSourceUrls = sources.urls.map((s: { url: string }) => s.url);
      }
    }

    // Enqueue pipeline run (replaces LangGraph HTTP dispatch)
    try {
      jobManager.enqueue(podcast.id, {
        podcastId: podcast.id,
        userId: user.id,
        topic,
        clarifyingAnswers: clarifyingAnswers || [],
        hasAds,
        trustedSourceUrls,
        tier: subscription.tier,
      });
    } catch (err) {
      // Job already enqueued (deduplication) — this is fine, return success
      const isDuplicate = err instanceof Error && err.message.includes("already enqueued");
      if (!isDuplicate) throw err;
    }

    return c.json({ podcastId: podcast.id, status: "queued" });
  } catch {
    return c.json({ error: "Failed to submit podcast" }, 500);
  }
});

export { route as submitPodcastRoute };
