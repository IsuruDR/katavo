/**
 * POST /api/submit-podcast
 *
 * Validates credits, deducts one credit (CAS), creates podcast record,
 * enqueues pipeline run via job manager.
 *
 * Request body: { topic, clarifyingAnswers?, parentPodcastId?, sourceChapterTitle? }
 *   - parentPodcastId + sourceChapterTitle set: this is a chapter expansion.
 *     Server validates parent ownership, chapter existence, idempotency
 *     (one expansion per parent+chapter), and the parent has chapter_transcripts
 *     populated. Flips profiles.has_used_expand to true after successful submit.
 *
 * Response (new podcast): { podcastId, status: "queued" }
 * Response (existing expansion): 409 { podcastId, status: "exists" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";
import type { JobManager } from "../jobs/jobManager.js";
import {
  fetchParentContext,
  buildResearchDigest,
  type ParentContext,
} from "../lib/parentContext.js";

const route = new Hono();

/**
 * Must be called once at startup to inject the job manager dependency.
 * This avoids circular imports between routes and the job manager.
 */
let jobManager: JobManager;
export function setJobManager(jm: JobManager): void {
  jobManager = jm;
}

// SEC-2: bound the size of user input that flows into LLM prompts. Real
// topics are short; long inputs are abuse or accidental paste-of-an-essay.
// Per-answer cap is generous (most clarifying answers are a sentence or two).
const MAX_TOPIC_LENGTH = 500;
const MAX_ANSWER_LENGTH = 1000;

route.post("/", userAuth, async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const topic = body.topic;
    const clarifyingAnswers = body.clarifyingAnswers ?? body.clarifying_answers ?? [];
    const parentPodcastId: string | undefined = body.parentPodcastId ?? body.parent_podcast_id;
    const sourceChapterTitle: string | undefined = body.sourceChapterTitle ?? body.source_chapter_title;
    const isExpansion = !!parentPodcastId;

    if (isExpansion && !sourceChapterTitle) {
      return c.json({ error: "sourceChapterTitle required when parentPodcastId set" }, 400);
    }

    // Length caps on user input. Topic is required for non-expansion runs;
    // expansions reuse the parent's topic so the field can be empty.
    if (!isExpansion) {
      if (typeof topic !== "string" || topic.trim().length === 0) {
        return c.json({ error: "Topic is required" }, 400);
      }
      if (topic.length > MAX_TOPIC_LENGTH) {
        return c.json(
          { error: `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer.` },
          400,
        );
      }
    }
    if (Array.isArray(clarifyingAnswers)) {
      for (const entry of clarifyingAnswers) {
        if (typeof entry?.a === "string" && entry.a.length > MAX_ANSWER_LENGTH) {
          return c.json(
            { error: `Clarifying answers must be ${MAX_ANSWER_LENGTH} characters or fewer.` },
            400,
          );
        }
      }
    }

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

    // Pull preferred voice. Null means use pipeline default (TTS_VOICE).
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("preferred_voice")
      .eq("id", user.id)
      .single();
    const voice = profile?.preferred_voice ?? null;

    // Validate expansion: parent ownership, chapter existence, idempotency,
    // and transcript availability. Run before quota checks so a 409 (already
    // exists) never consumes a credit slot.
    let expansionContext: {
      parent: ParentContext;
      parentChapterTranscript: string;
      parentResearchDigest: string;
    } | null = null;

    if (isExpansion) {
      const parent = await fetchParentContext(serviceClient, parentPodcastId!, user.id);
      if (!parent) {
        return c.json({ error: "Parent podcast not found" }, 404);
      }

      const titles = parent.chapter_markers.map((m) => m.title);
      if (!titles.includes(sourceChapterTitle!)) {
        return c.json({ error: "Source chapter not found in parent" }, 400);
      }

      const { data: existing } = await serviceClient
        .from("podcasts")
        .select("id")
        .eq("parent_podcast_id", parentPodcastId!)
        .eq("source_chapter_title", sourceChapterTitle!)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        return c.json({ podcastId: existing.id, status: "exists" }, 409);
      }

      const chapterTranscript = parent.chapter_transcripts?.[sourceChapterTitle!];
      if (!chapterTranscript) {
        return c.json(
          { error: "This podcast can't be expanded — regenerate it to enable expansions." },
          400,
        );
      }

      expansionContext = {
        parent,
        parentChapterTranscript: chapterTranscript,
        parentResearchDigest: buildResearchDigest(parent.research_document),
      };
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

    // Two-bucket credit deduction (migration 00025). credits_remaining is the
    // monthly bucket, reset by RevenueCat webhooks on every lifecycle event.
    // bonus_credits is the signup welcome credit, never touched by webhooks.
    // Deduct from monthly first (use-it-or-lose-it) and fall back to bonus
    // only when monthly is empty. handle_podcast_failure refunds always to
    // credits_remaining; the asymmetry nets out in the ledger and over the
    // long run users come out ahead by a small amount, which is fine.
    const bonusRemaining = subscription.bonus_credits ?? 0;
    if (subscription.credits_remaining <= 0 && bonusRemaining <= 0) {
      return c.json(
        { error: "No credits remaining. Purchase more credits to continue." },
        402,
      );
    }

    let deductedBucket: "monthly" | "bonus" | null = null;
    let casError: { code?: string; message?: string } | null = null;

    if (subscription.credits_remaining > 0) {
      const { data: cas, error } = await serviceClient
        .from("subscriptions")
        .update({ credits_remaining: subscription.credits_remaining - 1 })
        .eq("user_id", user.id)
        .eq("credits_remaining", subscription.credits_remaining)
        .gt("credits_remaining", 0)
        .select("credits_remaining")
        .single();
      if (error && error.code !== "PGRST116") {
        casError = error;
      }
      if (cas) deductedBucket = "monthly";
    }

    if (!deductedBucket && bonusRemaining > 0) {
      const { data: cas, error } = await serviceClient
        .from("subscriptions")
        .update({ bonus_credits: bonusRemaining - 1 })
        .eq("user_id", user.id)
        .eq("bonus_credits", bonusRemaining)
        .gt("bonus_credits", 0)
        .select("bonus_credits")
        .single();
      if (error && error.code !== "PGRST116") {
        casError = error;
      }
      if (cas) deductedBucket = "bonus";
    }

    if (casError) {
      throw casError;
    }

    if (!deductedBucket) {
      // Both CAS attempts lost a race against a concurrent submit. Re-read
      // the latest balance to decide between "out of credits" and "transient
      // conflict, retry".
      const { data: currentSub } = await serviceClient
        .from("subscriptions")
        .select("credits_remaining, bonus_credits")
        .eq("user_id", user.id)
        .single();

      const total =
        (currentSub?.credits_remaining ?? 0) + (currentSub?.bonus_credits ?? 0);
      if (total <= 0) {
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
        topic: isExpansion ? `${expansionContext!.parent.topic}: ${sourceChapterTitle}` : topic,
        clarifying_answers: clarifyingAnswers || [],
        status: "queued",
        has_ads: hasAds,
        voice,
        parent_podcast_id: parentPodcastId ?? null,
        source_chapter_title: sourceChapterTitle ?? null,
      })
      .select()
      .single();

    if (insertError) {
      // Unique-index race on (parent_podcast_id, source_chapter_title):
      // two concurrent submits for the same chapter — the first wins,
      // the second hits idx_podcasts_unique_expansion. Refund the credit,
      // look up the winner, and return 409 like the pre-INSERT idempotency check.
      if (insertError.code === "23505" && isExpansion) {
        // Refund to the same bucket we just deducted from. Best-effort: if
        // this fails we still surface the 409 cleanly. The bucket sticker
        // (deductedBucket) is the only state that survives across the failed
        // INSERT path; re-reading from subscription would race the concurrent
        // winner that's also writing to credits_remaining.
        const refundColumn =
          deductedBucket === "bonus" ? "bonus_credits" : "credits_remaining";
        const { data: latestSub } = await serviceClient
          .from("subscriptions")
          .select("credits_remaining, bonus_credits")
          .eq("user_id", user.id)
          .single();
        const currentValue =
          (refundColumn === "bonus_credits"
            ? latestSub?.bonus_credits
            : latestSub?.credits_remaining) ?? 0;
        await serviceClient
          .from("subscriptions")
          .update({ [refundColumn]: currentValue + 1 })
          .eq("user_id", user.id);
        const { data: winner } = await serviceClient
          .from("podcasts")
          .select("id")
          .eq("parent_podcast_id", parentPodcastId!)
          .eq("source_chapter_title", sourceChapterTitle!)
          .is("deleted_at", null)
          .maybeSingle();
        if (winner) {
          return c.json({ podcastId: winner.id, status: "exists" }, 409);
        }
        // Winner not found (extremely unlikely — would mean the row was
        // deleted between insert-fail and this select). Fall through to
        // the generic error path.
      }
      throw insertError;
    }

    // Record credit transaction
    await serviceClient.from("credit_transactions").insert({
      user_id: user.id,
      type: "deduction",
      amount: -1,
      podcast_id: podcast.id,
    });

    // Flip has_used_expand after first successful expansion (idempotent)
    if (isExpansion) {
      await serviceClient
        .from("profiles")
        .update({ has_used_expand: true })
        .eq("id", user.id)
        .eq("has_used_expand", false);
    }

    // Look up has_used_expand for the pipeline
    const { data: profileRow } = await serviceClient
      .from("profiles")
      .select("has_used_expand")
      .eq("id", user.id)
      .single();
    const hasUsedExpand = profileRow?.has_used_expand ?? false;

    // Enqueue pipeline run (replaces LangGraph HTTP dispatch)
    try {
      jobManager.enqueue(podcast.id, {
        podcastId: podcast.id,
        userId: user.id,
        topic: isExpansion ? expansionContext!.parent.topic : topic,
        clarifyingAnswers: clarifyingAnswers || [],
        hasAds,
        tier: subscription.tier,
        voice,
        parentPodcastId: parentPodcastId ?? null,
        sourceChapterTitle: sourceChapterTitle ?? null,
        parentResearchDigest: expansionContext?.parentResearchDigest ?? null,
        parentResearchDocument: expansionContext?.parent.research_document ?? null,
        parentChapterTranscript: expansionContext?.parentChapterTranscript ?? null,
        hasUsedExpand,
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
