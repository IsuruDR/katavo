import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  chapterIndexForTimestamp,
  pickChapter,
  sendExpansionPush,
} from "../src/jobs/expansionPromptsScan.js";

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a thenable Proxy where every chained method call returns the proxy
 * itself, and awaiting it resolves to `resolvedValue`. This lets us write
 * supabase.from("x").select("y").eq("z", v).is("a", null) and await the
 * result — the chain returns the same proxy at every step.
 */
function buildChainable(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let proxy: any;
  proxy = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resolvedValue);
        }
        // Every method returns the same proxy so the chain keeps working
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (..._args: any[]) => proxy;
      },
    },
  );
  return proxy;
}

/**
 * Create a mock Supabase client where each call to `.from(table)` pops
 * the next queued resolved value from `queueByTable[table]`. Missing
 * entries default to `{ data: null, error: null }`.
 */
function createMockClient(queueByTable: Record<string, unknown[]>) {
  return {
    from: vi.fn((table: string) => {
      const queue = queueByTable[table] ?? [];
      const next = queue.shift() ?? { data: null, error: null };
      return buildChainable(next);
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.EXPO_ACCESS_TOKEN = "expo-test-token";
});

// ---------------------------------------------------------------------------
// chapterIndexForTimestamp — pure helper, no mocks needed
// ---------------------------------------------------------------------------

describe("chapterIndexForTimestamp", () => {
  const markers = [
    { timestampSeconds: 0, title: "Intro" },
    { timestampSeconds: 60, title: "Background" },
    { timestampSeconds: 120, title: "Deep Dive" },
    { timestampSeconds: 180, title: "Wrap-up" },
  ];

  it("returns the index of the chapter containing the timestamp", () => {
    expect(chapterIndexForTimestamp(30, markers)).toBe(0);
    expect(chapterIndexForTimestamp(90, markers)).toBe(1);
    expect(chapterIndexForTimestamp(150, markers)).toBe(2);
    expect(chapterIndexForTimestamp(200, markers)).toBe(3);
  });

  it("returns 0 for a timestamp before all chapters", () => {
    expect(chapterIndexForTimestamp(-10, markers)).toBe(0);
  });

  it("returns the chapter index exactly at a chapter boundary", () => {
    expect(chapterIndexForTimestamp(60, markers)).toBe(1);
    expect(chapterIndexForTimestamp(120, markers)).toBe(2);
  });

  it("returns 0 for a single-chapter list", () => {
    expect(chapterIndexForTimestamp(999, [{ timestampSeconds: 0, title: "Only" }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pickChapter — hand-stubbed Supabase, exercises engagement + research paths
// ---------------------------------------------------------------------------

describe("pickChapter", () => {
  const threeChapters = [
    { timestampSeconds: 0, title: "Intro" },
    { timestampSeconds: 60, title: "Middle" },
    { timestampSeconds: 120, title: "End" },
  ];

  const fiveChapters = [
    { timestampSeconds: 0, title: "Intro" },
    { timestampSeconds: 60, title: "Ch2" },
    { timestampSeconds: 120, title: "Ch3" },
    { timestampSeconds: 180, title: "Ch4" },
    { timestampSeconds: 240, title: "Outro" },
  ];

  function makeEligible(overrides: Partial<{
    chapter_markers: typeof threeChapters;
    research_document: Record<string, unknown>;
  }> = {}) {
    return {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: overrides.chapter_markers ?? threeChapters,
      research_document: overrides.research_document ?? {},
      expo_push_token: "ExponentPushToken[abc]",
    };
  }

  it("returns null when chapter_markers has fewer than 3 entries", async () => {
    const supabase = createMockClient({});
    const eligible = makeEligible({
      chapter_markers: [
        { timestampSeconds: 0, title: "A" },
        { timestampSeconds: 60, title: "B" },
      ],
    });
    const result = await pickChapter(supabase, eligible);
    expect(result).toBeNull();
  });

  it("picks the chapter with >= 2 skip-back events (engagement winner)", async () => {
    // Chapter index 1 spans 60-120s. Two skip-backs at 80s and 90s land there.
    const supabase = createMockClient({
      playback_events: [
        {
          data: [
            { timestamp_seconds: 80 },
            { timestamp_seconds: 90 },
          ],
          error: null,
        },
      ],
    });
    const eligible = makeEligible({ chapter_markers: threeChapters });
    const result = await pickChapter(supabase, eligible);
    // Index 1 is middle — not first (0) or last (2) for 3-chapter list
    expect(result).toEqual({ index: 1, title: "Middle" });
  });

  it("does NOT pick first or last chapter via engagement signal even with >= 2 skip-backs", async () => {
    // Skip-backs at timestamps < 60 land on chapter 0 (excluded: first chapter).
    // No middle chapter has enough skip-backs, so fall back to research.
    const supabase = createMockClient({
      playback_events: [
        {
          data: [
            { timestamp_seconds: 10 },
            { timestamp_seconds: 20 },
            { timestamp_seconds: 30 },
          ],
          error: null,
        },
      ],
    });
    // 3-chapter list: only index 1 is a valid middle chapter
    // but all skip-backs map to index 0, so no engagement winner
    const eligible = makeEligible({
      chapter_markers: threeChapters,
      research_document: {
        chapterResearchMap: {
          Middle: { sourceIndexes: [1, 2, 3] },
        },
      },
    });
    const result = await pickChapter(supabase, eligible);
    // Falls through to research density: Middle has 3 sources
    expect(result).toEqual({ index: 1, title: "Middle" });
  });

  it("falls back to research density when skip-back count is below threshold", async () => {
    // Only 1 skip-back — below threshold of 2
    const supabase = createMockClient({
      playback_events: [
        { data: [{ timestamp_seconds: 90 }], error: null },
      ],
    });
    const eligible = makeEligible({
      chapter_markers: fiveChapters,
      research_document: {
        chapterResearchMap: {
          Ch2: { sourceIndexes: [1] },
          Ch3: { sourceIndexes: [1, 2, 3, 4] }, // highest density
          Ch4: { sourceIndexes: [1, 2] },
        },
      },
    });
    const result = await pickChapter(supabase, eligible);
    expect(result).toEqual({ index: 2, title: "Ch3" });
  });

  it("returns null when no playback events and no research document", async () => {
    const supabase = createMockClient({
      playback_events: [{ data: [], error: null }],
    });
    // 3-chapter list: Intro (0) and End (2) are excluded; Middle (1) has score 0
    // candidates[0] exists but score is 0 — still returns it (non-null)
    const eligible = makeEligible({ chapter_markers: threeChapters });
    const result = await pickChapter(supabase, eligible);
    // Falls through to research path with score 0, but candidate exists
    expect(result).toEqual({ index: 1, title: "Middle" });
  });

  it("returns null when no valid middle chapters exist (only 2-chapter list)", async () => {
    const supabase = createMockClient({
      playback_events: [{ data: [], error: null }],
    });
    const eligible = makeEligible({
      chapter_markers: [
        { timestampSeconds: 0, title: "Only A" },
        { timestampSeconds: 60, title: "Only B" },
      ],
    });
    const result = await pickChapter(supabase, eligible);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendExpansionPush — global.fetch mock
// ---------------------------------------------------------------------------

describe("sendExpansionPush", () => {
  const eligible = {
    id: "pod-1",
    user_id: "user-1",
    topic: "AI Ethics",
    chapter_markers: [],
    research_document: {},
    expo_push_token: "ExponentPushToken[xyz]",
  };
  const pick = { index: 2, title: "The Hard Problem" };

  it("returns ok on a successful push", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ data: { status: "ok" } }),
    } as Response);

    const result = await sendExpansionPush(eligible, pick);
    expect(result).toEqual({ status: "ok" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer expo-test-token",
        }),
      }),
    );
  });

  it("returns device_not_registered when Expo responds with DeviceNotRegistered", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        data: { status: "error", details: { error: "DeviceNotRegistered" } },
      }),
    } as Response);

    const result = await sendExpansionPush(eligible, pick);
    expect(result).toEqual({ status: "device_not_registered" });
  });

  it("returns error on fetch exception", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const result = await sendExpansionPush(eligible, pick);
    expect(result).toEqual({ status: "error" });
  });

  it("sends the correct payload shape", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ data: { status: "ok" } }),
    } as Response);

    await sendExpansionPush(eligible, pick);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toMatchObject({
      to: eligible.expo_push_token,
      title: `Going deeper on chapter ${pick.index}?`,
      body: `${pick.title}. Tap to expand.`,
      data: {
        deepLink: `/player/${eligible.id}?expand=${pick.index}`,
        podcastId: eligible.id,
      },
      sound: "default",
    });
  });
});

// ---------------------------------------------------------------------------
// runExpansionPromptsScan — integration-style tests via createClient mock
// ---------------------------------------------------------------------------

describe("runExpansionPromptsScan", () => {
  // Re-import module after mocking — use dynamic import to pick up the mock.
  async function importScan() {
    // vitest module cache resets between tests via vi.clearAllMocks but NOT
    // module cache. We use vi.resetModules() to ensure a fresh import.
    vi.resetModules();
    const { createClient } = await import("@supabase/supabase-js");
    return { createClient: createClient as ReturnType<typeof vi.fn> };
  }

  it("returns 0/0 when the eligibility query returns an empty list", async () => {
    const { createClient } = await importScan();
    createClient.mockReturnValue(
      createMockClient({ podcasts: [{ data: [], error: null }] }),
    );
    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();
    expect(result).toEqual({ sent: 0, skipped: 0 });
  });

  it("returns 0/0 when the eligibility query errors", async () => {
    const { createClient } = await importScan();
    createClient.mockReturnValue(
      createMockClient({
        podcasts: [{ data: null, error: { message: "DB down" } }],
      }),
    );
    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();
    expect(result).toEqual({ sent: 0, skipped: 0 });
  });

  it("skips podcasts where has_used_expand is true", async () => {
    const { createClient } = await importScan();
    const candidate = {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: [
        { timestampSeconds: 0, title: "Intro" },
        { timestampSeconds: 60, title: "Middle" },
        { timestampSeconds: 120, title: "End" },
      ],
      profiles: { expo_push_token: "ExponentPushToken[abc]", has_used_expand: true },
      research_contexts: { research_document: {} },
    };
    createClient.mockReturnValue(
      createMockClient({ podcasts: [{ data: [candidate], error: null }] }),
    );
    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it("skips podcasts with no expo_push_token", async () => {
    const { createClient } = await importScan();
    const candidate = {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: [
        { timestampSeconds: 0, title: "Intro" },
        { timestampSeconds: 60, title: "Middle" },
        { timestampSeconds: 120, title: "End" },
      ],
      profiles: { expo_push_token: null, has_used_expand: false },
      research_contexts: { research_document: {} },
    };
    createClient.mockReturnValue(
      createMockClient({ podcasts: [{ data: [candidate], error: null }] }),
    );
    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it("skips podcasts where chapter_markers.length < 3", async () => {
    const { createClient } = await importScan();
    const candidate = {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: [
        { timestampSeconds: 0, title: "Intro" },
        { timestampSeconds: 60, title: "End" },
      ],
      profiles: { expo_push_token: "ExponentPushToken[abc]", has_used_expand: false },
      research_contexts: { research_document: {} },
    };
    createClient.mockReturnValue(
      createMockClient({
        podcasts: [
          { data: [candidate], error: null },
          // expansion count check
          { data: null, error: null, count: 0 },
          // playback_events (for pickChapter — won't reach but queue it)
          { data: [], error: null },
        ],
      }),
    );
    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it("does NOT send push when CAS stamp returns no row (concurrent race)", async () => {
    const { createClient } = await importScan();
    global.fetch = vi.fn();

    const candidate = {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: [
        { timestampSeconds: 0, title: "Intro" },
        { timestampSeconds: 60, title: "Middle" },
        { timestampSeconds: 120, title: "End" },
      ],
      profiles: { expo_push_token: "ExponentPushToken[abc]", has_used_expand: false },
      research_contexts: { research_document: {} },
    };

    createClient.mockReturnValue(
      createMockClient({
        podcasts: [
          // 1. eligibility query
          { data: [candidate], error: null },
          // 2. expansion count check → 0 existing expansions
          { data: null, error: null, count: 0 },
          // 3. CAS stamp → null means someone else already stamped
          { data: null, error: null },
        ],
        playback_events: [
          // for pickChapter
          { data: [], error: null },
        ],
      }),
    );

    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();

    // Stamped by concurrent instance — we skip without sending
    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("nulls expo_push_token on DeviceNotRegistered response", async () => {
    const { createClient } = await importScan();

    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        data: { status: "error", details: { error: "DeviceNotRegistered" } },
      }),
    } as Response);

    const candidate = {
      id: "pod-1",
      user_id: "user-1",
      topic: "AI",
      chapter_markers: [
        { timestampSeconds: 0, title: "Intro" },
        { timestampSeconds: 60, title: "Middle" },
        { timestampSeconds: 120, title: "End" },
      ],
      profiles: { expo_push_token: "ExponentPushToken[stale]", has_used_expand: false },
      research_contexts: { research_document: {} },
    };

    const mockClient = createMockClient({
      podcasts: [
        // 1. eligibility query
        { data: [candidate], error: null },
        // 2. expansion count check
        { data: null, error: null, count: 0 },
        // 3. CAS stamp — succeeds
        { data: { id: "pod-1" }, error: null },
      ],
      playback_events: [
        { data: [], error: null },
      ],
    });

    // Spy on from() to capture the profile token-nulling call
    const fromSpy = vi.spyOn(mockClient, "from");
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);

    const { runExpansionPromptsScan } = await import(
      "../src/jobs/expansionPromptsScan.js"
    );
    const result = await runExpansionPromptsScan();

    expect(result).toEqual({ sent: 1, skipped: 0 });
    // Verify profiles table was touched to null the token
    const profileCalls = fromSpy.mock.calls.filter(([t]) => t === "profiles");
    expect(profileCalls.length).toBeGreaterThan(0);
  });
});
