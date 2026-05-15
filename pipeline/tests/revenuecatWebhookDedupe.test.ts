import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

import { revenuecatWebhookRoute } from "../src/routes/revenuecatWebhook.js";

function buildApp() {
  const app = new Hono();
  app.route("/api/revenucat-webhook", revenuecatWebhookRoute);
  return app;
}

function authHeaders() {
  return { Authorization: `Bearer ${process.env.REVENUCAT_WEBHOOK_SECRET}` };
}

interface MockOpts {
  dedupeError?: { code: string } | null;
}

/**
 * Mock just enough of the Supabase client to verify the dedupe insert and
 * not crash the downstream switch branches. The first .from() call goes
 * to webhook_events.insert; subsequent calls fall through to a permissive
 * chainable stub so any of the existing subscription/credit handlers
 * still resolve.
 */
function buildSupabase(opts: MockOpts = {}) {
  const dedupeInsert = vi.fn().mockResolvedValue({
    data: null,
    error: opts.dedupeError ?? null,
  });
  const dedupeChain = { insert: dedupeInsert };

  const passthroughChain: any = {
    update: vi.fn(() => passthroughChain),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn(() => passthroughChain),
    eq: vi.fn(() => passthroughChain),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: "user-1" }, error: null }),
  };

  let fromCalls = 0;
  return {
    from: vi.fn((table: string) => {
      fromCalls += 1;
      if (table === "webhook_events") return dedupeChain;
      return passthroughChain;
    }),
    dedupeInsert,
    callCount: () => fromCalls,
  } as any;
}

const SAMPLE_EVENT = {
  event: {
    id: "evt-123",
    type: "INITIAL_PURCHASE",
    app_user_id: "user-1",
    product_id: "plus_monthly",
    expiration_at_ms: 0,
  },
};

describe("revenuecatWebhook dedupe", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.REVENUCAT_WEBHOOK_SECRET = "wh-secret";
  });

  it("inserts the event_id and processes a fresh event", async () => {
    const mock = buildSupabase();
    mockCreateClient.mockReturnValue(mock);

    const res = await buildApp().request("/api/revenucat-webhook", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(SAMPLE_EVENT),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true });
    expect(mock.dedupeInsert).toHaveBeenCalledWith({
      event_id: "evt-123",
      source: "revenuecat",
    });
  });

  it("short-circuits with duplicate: true on 23505 PK conflict", async () => {
    const mock = buildSupabase({ dedupeError: { code: "23505" } });
    mockCreateClient.mockReturnValue(mock);

    const res = await buildApp().request("/api/revenucat-webhook", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(SAMPLE_EVENT),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true, duplicate: true });
    // The dedupe insert ran, but no subscription/credit_transactions writes did.
    expect(mock.callCount()).toBe(1);
  });

  it("returns 500 on dedupe insert failure (non-23505)", async () => {
    const mock = buildSupabase({ dedupeError: { code: "42P01" } }); // table missing
    mockCreateClient.mockReturnValue(mock);

    const res = await buildApp().request("/api/revenucat-webhook", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(SAMPLE_EVENT),
    });

    expect(res.status).toBe(500);
  });

  it("rejects without the bearer secret", async () => {
    const res = await buildApp().request("/api/revenucat-webhook", {
      method: "POST",
      body: JSON.stringify(SAMPLE_EVENT),
    });
    expect(res.status).toBe(401);
  });
});
