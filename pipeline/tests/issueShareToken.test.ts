import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

// Mock userAuth to attach a deterministic user without touching real Supabase.
// The route file still imports the real userAuth, so tsc against the source
// gets full Hono env inference; only at test runtime is the mock substituted.
vi.mock("../src/middleware/auth.js", () => ({
  userAuth: async (c: any, next: any) => {
    c.set("user", { id: "user-123" });
    await next();
  },
}));

import { issueShareTokenRoute } from "../src/routes/issueShareToken.js";

function buildApp() {
  const app = new Hono();
  app.route("/api/share-podcast", issueShareTokenRoute);
  return app;
}

function buildSupabaseMock(opts: {
  podcast?: any;
  podcastErr?: any;
  updateCount?: number;
  updateErr?: any;
  freshAfterRace?: any;
}) {
  const podcastSelect = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.podcast ?? null, error: opts.podcastErr ?? null }),
  };
  const updateBuilder = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ error: opts.updateErr ?? null, count: opts.updateCount ?? 1 }),
  };
  const freshSelect = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.freshAfterRace ?? null, error: null }),
  };
  let fromCallCount = 0;
  return {
    from: vi.fn(() => {
      const call = fromCallCount++;
      if (call === 0) return podcastSelect;
      if (call === 1) return updateBuilder;
      return freshSelect;
    }),
  } as any;
}

describe("POST /api/share-podcast/:podcastId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  });

  it("issues a fresh 10-char base64url token for the owner", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "user-123", status: "complete", deleted_at: null, share_token: null },
        updateCount: 1,
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it("returns 403 when caller is not the podcast owner", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "someone-else", status: "complete", deleted_at: null, share_token: null },
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when the podcast is not in status 'complete'", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "user-123", status: "researching", deleted_at: null, share_token: null },
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 404 when the podcast doesn't exist", async () => {
    mockCreateClient.mockReturnValue(buildSupabaseMock({ podcast: null }));
    const res = await buildApp().request("/api/share-podcast/missing", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the podcast is soft-deleted", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "user-123", status: "complete", deleted_at: "2026-01-01T00:00:00Z", share_token: null },
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns the existing token without re-issuing (idempotent)", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "user-123", status: "complete", deleted_at: null, share_token: "existing01" },
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe("existing01");
  });

  it("returns the winner's token when the update races and matches 0 rows", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        podcast: { id: "p1", user_id: "user-123", status: "complete", deleted_at: null, share_token: null },
        updateCount: 0,
        freshAfterRace: { share_token: "winnerXYZ_" },
      }),
    );
    const res = await buildApp().request("/api/share-podcast/p1", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe("winnerXYZ_");
  });
});
