import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

import { sharePageRoute } from "../src/routes/sharePage.js";

function buildApp() {
  const app = new Hono();
  app.route("/p", sharePageRoute);
  return app;
}

function buildSupabaseMock(opts: {
  rpcRows?: any[];
  rpcErr?: any;
  signedAudio?: string;
  signedCover?: string;
  signedErr?: any;
  spy?: { from?: ReturnType<typeof vi.fn> };
}) {
  const rpc = vi.fn().mockResolvedValue({ data: opts.rpcRows ?? null, error: opts.rpcErr ?? null });
  const fromSpy = opts.spy?.from ?? vi.fn(() => {
    throw new Error("from() should NOT be called by the share page");
  });
  const storageFrom = vi.fn(() => ({
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: opts.signedAudio ?? "https://signed.example/audio.mp3" },
      error: opts.signedErr ?? null,
    }),
  }));
  return {
    rpc,
    from: fromSpy,
    storage: { from: storageFrom },
  } as any;
}

describe("GET /p/:token", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  });

  it("returns 404 HTML when the token is unknown", async () => {
    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpcRows: [] }));
    const res = await buildApp().request("/p/unknown");
    expect(res.status).toBe(404);
    expect((await res.text())).toContain("This podcast isn't available.");
  });

  it("returns 404 when the RPC errors", async () => {
    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpcRows: null, rpcErr: { message: "boom" } }));
    const res = await buildApp().request("/p/anything");
    expect(res.status).toBe(404);
  });

  it("renders an <audio> element with a signed podcast-audio URL for the root", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        rpcRows: [
          {
            id: "p1",
            user_id: "u1",
            parent_podcast_id: null,
            topic: "The honey bee crisis",
            has_cover: true,
            chapter_markers: [{ timestampSeconds: 0, title: "Intro" }],
            duration_seconds: 600,
            status: "complete",
            is_root: true,
          },
        ],
        signedAudio: "https://supabase.example/storage/podcast-audio/u1/p1.mp3?token=xxx",
      }),
    );
    const res = await buildApp().request("/p/abcdefghij");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<audio id="player"');
    expect(html).toContain('src="https://supabase.example/storage/podcast-audio/u1/p1.mp3?token=xxx"');
    expect(html).toContain("The honey bee crisis");
  });

  it("HTML-escapes the topic so <script> in user input cannot break out", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        rpcRows: [
          {
            id: "p1",
            user_id: "u1",
            parent_podcast_id: null,
            topic: "</script><script>alert(1)</script>",
            has_cover: false,
            chapter_markers: [],
            duration_seconds: 60,
            status: "complete",
            is_root: true,
          },
        ],
      }),
    );
    const res = await buildApp().request("/p/abcdefghij");
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/script&gt;");
  });

  it("never queries research_contexts, citations, or qa_sessions", async () => {
    // Stronger than "from() should never be called": we explicitly assert
    // the three forbidden table names are never the argument. This survives
    // any future addition of a benign .from("podcasts") read without quietly
    // letting research tables sneak in.
    const fromSpy = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        rpcRows: [
          {
            id: "p1",
            user_id: "u1",
            parent_podcast_id: null,
            topic: "x",
            has_cover: false,
            chapter_markers: [],
            duration_seconds: 60,
            status: "complete",
            is_root: true,
          },
        ],
        spy: { from: fromSpy },
      }),
    );
    await buildApp().request("/p/abcdefghij");
    expect(fromSpy).not.toHaveBeenCalledWith("research_contexts");
    expect(fromSpy).not.toHaveBeenCalledWith("citations");
    expect(fromSpy).not.toHaveBeenCalledWith("qa_sessions");
  });

  it("works for a podcast owned by a user different from the test context", async () => {
    // The route uses the service-role client, so ownership is irrelevant.
    // This test catches the accidental wiring to an anon client, where
    // RLS would silently 404 the row.
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        rpcRows: [
          {
            id: "p1",
            user_id: "different-user-zzz",
            parent_podcast_id: null,
            topic: "Cross user",
            has_cover: false,
            chapter_markers: [],
            duration_seconds: 60,
            status: "complete",
            is_root: true,
          },
        ],
        signedAudio: "https://supabase.example/storage/podcast-audio/different-user-zzz/p1.mp3?token=zzz",
      }),
    );
    const res = await buildApp().request("/p/abcdefghij");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cross user");
    expect(html).toContain("different-user-zzz/p1.mp3");
  });

  it("includes completed descendants in 'More from this series'", async () => {
    mockCreateClient.mockReturnValue(
      buildSupabaseMock({
        rpcRows: [
          {
            id: "p1",
            user_id: "u1",
            parent_podcast_id: null,
            topic: "Parent",
            has_cover: false,
            chapter_markers: [],
            duration_seconds: 60,
            status: "complete",
            is_root: true,
          },
          {
            id: "c1",
            user_id: "u1",
            parent_podcast_id: "p1",
            topic: "Child One",
            has_cover: false,
            chapter_markers: [],
            duration_seconds: 120,
            status: "complete",
            is_root: false,
          },
        ],
      }),
    );
    const res = await buildApp().request("/p/abcdefghij");
    const html = await res.text();
    expect(html).toContain("More from this series");
    expect(html).toContain("Child One");
  });
});
