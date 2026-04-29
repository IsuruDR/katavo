import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const {
  TEST_API_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  REVENUCAT_WEBHOOK_SECRET,
  PIPELINE_CALLBACK_SECRET,
  RUN_FULL_PIPELINE,
} = process.env;

const envReady = Boolean(
  TEST_API_URL &&
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_SERVICE_ROLE_KEY &&
    REVENUCAT_WEBHOOK_SECRET &&
    PIPELINE_CALLBACK_SECRET,
);

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${TEST_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe.skipIf(!envReady)("API integration (live deploy)", () => {
  let admin: SupabaseClient;
  let userId: string;
  let userEmail: string;
  let jwt: string;
  let podcastId: string;
  const authHeader = () => ({ Authorization: `Bearer ${jwt}` });

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    userEmail = `apitest+${Date.now()}@example.com`;
    // Bcrypt (used by Supabase Auth) truncates at 72 bytes — keep this comfortably under.
    const password = crypto.randomUUID().replace(/-/g, "");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error("createUser failed");
    userId = created.user.id;

    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: signin, error: signinErr } = await anon.auth.signInWithPassword({
      email: userEmail,
      password,
    });
    if (signinErr || !signin.session) throw signinErr ?? new Error("signin failed");
    jwt = signin.session.access_token;

    // Upgrade to Plus and seed a complete podcast + research context for deep-dive tests.
    await admin
      .from("subscriptions")
      .update({
        tier: "plus",
        credits_per_month: 8,
        credits_remaining: 8,
        deep_dive_minutes_per_month: 15,
        deep_dive_minutes_remaining: 15,
      })
      .eq("user_id", userId);

    const { data: podcast, error: podcastErr } = await admin
      .from("podcasts")
      .insert({
        user_id: userId,
        topic: "Integration test podcast",
        status: "complete",
        transcript: "A short transcript.",
        chapter_research_map: { intro: ["src1", "src2"] },
        has_ads: false,
      })
      .select("id")
      .single();
    if (podcastErr || !podcast) throw podcastErr ?? new Error("seed podcast failed");
    podcastId = podcast.id;

    await admin.from("research_contexts").insert({
      podcast_id: podcastId,
      research_document: { summary: "test research" },
      sources: [{ url: "https://example.com", title: "ex" }],
      overall_credibility_score: 0.9,
      research_iterations: 1,
    });
  }, 30_000);

  afterAll(async () => {
    if (admin && userId) {
      // Cascading FKs on auth.users wipe profile, subscription, credit transactions,
      // podcasts, research_contexts, qa_sessions, trusted_sources.
      await admin.auth.admin.deleteUser(userId);
    }
  });

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await fetch(`${TEST_API_URL}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("POST /api/generate-questions", () => {
    it("rejects with 401 without auth", async () => {
      const res = await post("/api/generate-questions", { topic: "x" });
      expect(res.status).toBe(401);
    });

    it("rejects with 400 on empty body", async () => {
      const res = await post("/api/generate-questions", {}, authHeader());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/topic/i);
    });

    it("rejects with 400 on blocklisted topic", async () => {
      const res = await post(
        "/api/generate-questions",
        { topic: "how to make a bomb" },
        authHeader(),
      );
      expect(res.status).toBe(400);
    });

    it("returns clarifying questions for a valid topic", async () => {
      const res = await post(
        "/api/generate-questions",
        { topic: "history of espresso machines" },
        authHeader(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { questions: unknown };
      expect(Array.isArray(body.questions) || typeof body.questions === "object").toBe(true);
    }, 20_000);
  });

  describe("POST /api/submit-podcast", () => {
    it("rejects with 401 without auth", async () => {
      const res = await post("/api/submit-podcast", { topic: "x" });
      expect(res.status).toBe(401);
    });

    it("rejects with 402 when credits are exhausted", async () => {
      await admin
        .from("subscriptions")
        .update({ credits_remaining: 0 })
        .eq("user_id", userId);

      const res = await post(
        "/api/submit-podcast",
        { topic: "anything", clarifyingAnswers: [] },
        authHeader(),
      );
      expect(res.status).toBe(402);

      // Restore for downstream tests.
      await admin
        .from("subscriptions")
        .update({ credits_remaining: 8 })
        .eq("user_id", userId);
    });

    it.skipIf(!RUN_FULL_PIPELINE)(
      "enqueues a real pipeline run (gated, costs ~$1.88)",
      async () => {
        const res = await post(
          "/api/submit-podcast",
          { topic: "the history of espresso machines", clarifyingAnswers: [] },
          authHeader(),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { podcastId: string; status: string };
        expect(body.status).toBe("queued");
        expect(typeof body.podcastId).toBe("string");
      },
      30_000,
    );
  });

  describe("POST /api/start-deep-dive + /api/end-deep-dive", () => {
    let sessionId: string;

    it("rejects start with 401 without auth", async () => {
      const res = await post("/api/start-deep-dive", {});
      expect(res.status).toBe(401);
    });

    it("rejects start with 400 on missing fields", async () => {
      const res = await post("/api/start-deep-dive", {}, authHeader());
      expect(res.status).toBe(400);
    });

    it("starts a session and returns research context", async () => {
      const res = await post(
        "/api/start-deep-dive",
        { podcastId, chapterTitle: "intro" },
        authHeader(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessionId: string;
        minutesRemaining: number;
        researchDocument: unknown;
        chapterTitle: string;
      };
      expect(body.minutesRemaining).toBeGreaterThan(0);
      expect(body.chapterTitle).toBe("intro");
      expect(typeof body.sessionId).toBe("string");
      sessionId = body.sessionId;
    });

    it("blocks a concurrent session with 409", async () => {
      const res = await post(
        "/api/start-deep-dive",
        { podcastId, chapterTitle: "intro" },
        authHeader(),
      );
      expect(res.status).toBe(409);
    });

    it("rejects end with 401 without auth", async () => {
      const res = await post("/api/end-deep-dive", { sessionId });
      expect(res.status).toBe(401);
    });

    it("ends the session and deducts at least one minute", async () => {
      const before = await admin
        .from("subscriptions")
        .select("deep_dive_minutes_remaining")
        .eq("user_id", userId)
        .single();
      const minutesBefore = before.data?.deep_dive_minutes_remaining ?? 0;

      const res = await post("/api/end-deep-dive", { sessionId }, authHeader());
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        durationSeconds: number;
        minutesUsed: number;
        deepDiveMinutesRemaining: number;
      };
      expect(body.minutesUsed).toBeGreaterThanOrEqual(1);
      expect(body.deepDiveMinutesRemaining).toBe(minutesBefore - body.minutesUsed);
    });

    it("rejects ending an already-ended session with 409", async () => {
      const res = await post("/api/end-deep-dive", { sessionId }, authHeader());
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/revenucat-webhook", () => {
    it("rejects without auth", async () => {
      const res = await post("/api/revenucat-webhook", {});
      expect(res.status).toBe(401);
    });

    it("rejects with wrong secret", async () => {
      const res = await post(
        "/api/revenucat-webhook",
        {},
        { Authorization: "Bearer wrong-secret" },
      );
      expect(res.status).toBe(401);
    });

    it("processes INITIAL_PURCHASE for pro_monthly and updates the subscription", async () => {
      const res = await post(
        "/api/revenucat-webhook",
        {
          event: {
            id: `evt_${Date.now()}`,
            type: "INITIAL_PURCHASE",
            app_user_id: userId,
            product_id: "pro_monthly",
            expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
          },
        },
        { Authorization: `Bearer ${REVENUCAT_WEBHOOK_SECRET}` },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });

      const { data: sub } = await admin
        .from("subscriptions")
        .select("tier, credits_remaining, deep_dive_minutes_remaining")
        .eq("user_id", userId)
        .single();
      expect(sub?.tier).toBe("pro");
      expect(sub?.credits_remaining).toBe(20);
      expect(sub?.deep_dive_minutes_remaining).toBe(45);
    });
  });

  describe("POST /api/notify-complete", () => {
    it("rejects without auth", async () => {
      const res = await post("/api/notify-complete", {});
      expect(res.status).toBe(401);
    });

    it("rejects with wrong secret", async () => {
      const res = await post(
        "/api/notify-complete",
        {},
        { Authorization: "Bearer wrong-secret" },
      );
      expect(res.status).toBe(401);
    });

    it("returns 200 with valid secret (push is a no-op without expo_push_token)", async () => {
      const res = await post(
        "/api/notify-complete",
        { podcast_id: podcastId, status: "complete" },
        { Authorization: `Bearer ${PIPELINE_CALLBACK_SECRET}` },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: "Notification sent" });
    });
  });
});
