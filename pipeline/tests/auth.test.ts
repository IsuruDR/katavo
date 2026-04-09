import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { userAuth, webhookAuth, internalAuth } from "../src/middleware/auth.js";

// Mock @supabase/supabase-js
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

describe("auth middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.PIPELINE_CALLBACK_SECRET = "test-internal-secret";
    process.env.REVENUCAT_WEBHOOK_SECRET = "test-webhook-secret";
  });

  describe("userAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/protected", userAuth);
      app.get("/protected", (c) => {
        const user = c.get("user");
        return c.json({ userId: user.id });
      });
      return app;
    }

    it("returns 401 when no Authorization header is provided", async () => {
      const app = createApp();
      const res = await app.request("/protected");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 when Supabase auth fails", async () => {
      mockCreateClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "Invalid token" },
          }),
        },
      } as any);

      const app = createApp();
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer invalid-token" },
      });
      expect(res.status).toBe(401);
    });

    it("sets user on context when auth succeeds", async () => {
      const mockUser = { id: "user-123", email: "test@example.com" };
      mockCreateClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: mockUser },
            error: null,
          }),
        },
      } as any);

      const app = createApp();
      const res = await app.request("/protected", {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("user-123");
    });

    it("passes the Authorization header to Supabase client", async () => {
      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });
      mockCreateClient.mockReturnValue({ auth: { getUser: mockGetUser } } as any);

      const app = createApp();
      await app.request("/protected", {
        headers: { Authorization: "Bearer my-jwt" },
      });

      expect(mockCreateClient).toHaveBeenCalledWith(
        "http://localhost:54321",
        "test-anon-key",
        { global: { headers: { Authorization: "Bearer my-jwt" } } },
      );
    });
  });

  describe("webhookAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/webhook", webhookAuth);
      app.post("/webhook", (c) => c.json({ ok: true }));
      return app;
    }

    it("returns 401 when no Authorization header", async () => {
      const app = createApp();
      const res = await app.request("/webhook", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("returns 401 when secret does not match", async () => {
      const app = createApp();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("passes when secret matches REVENUCAT_WEBHOOK_SECRET", async () => {
      const app = createApp();
      const res = await app.request("/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer test-webhook-secret" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("internalAuth", () => {
    function createApp() {
      const app = new Hono();
      app.use("/internal", internalAuth);
      app.post("/internal", (c) => c.json({ ok: true }));
      return app;
    }

    it("returns 401 when no Authorization header", async () => {
      const app = createApp();
      const res = await app.request("/internal", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("returns 401 when secret does not match", async () => {
      const app = createApp();
      const res = await app.request("/internal", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("passes when secret matches PIPELINE_CALLBACK_SECRET", async () => {
      const app = createApp();
      const res = await app.request("/internal", {
        method: "POST",
        headers: { Authorization: "Bearer test-internal-secret" },
      });
      expect(res.status).toBe(200);
    });
  });
});
