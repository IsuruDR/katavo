# Podcast Sharing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship public share links so any user can hand a podcast to a friend who opens it in a browser without the app. Audio and chapters become public; research stays private.

**Architecture:** One column (`share_token`) plus one `SECURITY DEFINER` RPC on Postgres. Server-side token issuance via a new authed pipeline endpoint. Public Hono route renders an HTML page with re-signed Storage URLs on each request. Mobile gets a share NavRow built on a shared primitive that ResearchNavRow also adopts.

**Tech Stack:** Supabase Postgres + Storage, Hono on Railway (`@hono/node-server` + `serveStatic`), vitest for pipeline tests, React Native (Expo Router) for mobile. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-14-podcast-sharing-design.md`

---

## Chunk 1: Database schema and mobile type wiring

This chunk lands the migration and threads `share_token` through the mobile data layer so the rest of the work has a stable shape to read from.

### Task 1: Migration 00022 (share_token column + get_shared_tree RPC)

**Files:**
- Create: `supabase/migrations/00022_share_token.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00022_share_token.sql`:

```sql
-- 00022_share_token.sql
-- Adds public share-link support for podcasts.
--
-- One column (share_token) on podcasts marks a podcast as shareable.
-- One SECURITY DEFINER RPC (get_shared_tree) returns the matched
-- podcast plus its live, completed descendants in one round-trip.
-- The RPC is callable only by service_role; anon and authenticated
-- cannot reach it, so the public share route on the pipeline server
-- is the only path to the data.

ALTER TABLE public.podcasts
  ADD COLUMN share_token text;

CREATE UNIQUE INDEX podcasts_share_token_unique
  ON public.podcasts (share_token)
  WHERE share_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_shared_tree(p_token text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  parent_podcast_id uuid,
  topic text,
  has_cover boolean,
  chapter_markers jsonb,
  duration_seconds int,
  status text,
  is_root boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree AS (
    SELECT p.id, p.user_id, p.parent_podcast_id, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, true AS is_root
    FROM podcasts p
    WHERE p.share_token = p_token
      AND p.deleted_at IS NULL
      AND p.status = 'complete'
    UNION ALL
    SELECT p.id, p.user_id, p.parent_podcast_id, p.topic,
           (p.cover_url IS NOT NULL) AS has_cover,
           p.chapter_markers, p.duration_seconds, p.status, false AS is_root
    FROM podcasts p
    INNER JOIN tree t ON p.parent_podcast_id = t.id
    WHERE p.deleted_at IS NULL
      AND p.status = 'complete'
  )
  SELECT id, user_id, parent_podcast_id, topic, has_cover,
         chapter_markers, duration_seconds, status, is_root
  FROM tree;
$$;

REVOKE ALL ON FUNCTION public.get_shared_tree(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_tree(text) TO service_role;
```

- [ ] **Step 2: Apply the migration to the remote project**

Use the Supabase MCP `mcp__supabase__apply_migration` tool with the contents above. Name the migration `00022_share_token`. The MCP tool only applies remotely; the local file at `supabase/migrations/00022_share_token.sql` is what step 1 just created. Confirm `mcp__supabase__list_migrations` shows it applied.

- [ ] **Step 3: Verify column and RPC exist**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'podcasts' AND column_name = 'share_token';
```
Expected: one row with `data_type = text`.

```sql
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'get_shared_tree';
```
Expected: one row with `prosecdef = true` (SECURITY DEFINER).

```sql
SELECT has_function_privilege('anon', 'public.get_shared_tree(text)', 'EXECUTE');
```
Expected: `false`. Same with `authenticated`. `service_role` returns `true`.

- [ ] **Step 4: Smoke-test the RPC against an existing podcast**

Find a real podcast id and a parent/child pair in the DB. Manually set a token, then call the RPC. Reset afterwards.

```sql
-- Pick any complete parent + child pair
SELECT id, parent_podcast_id, status FROM podcasts WHERE deleted_at IS NULL AND status = 'complete' ORDER BY created_at DESC LIMIT 5;

-- Set a token on the parent (replace UUID)
UPDATE podcasts SET share_token = 'test_token_123' WHERE id = '<parent-uuid>';

-- Call the RPC (MCP execute_sql runs as service_role, so this works)
SELECT id, is_root FROM public.get_shared_tree('test_token_123');

-- Expected: parent row with is_root=true, plus any complete children with is_root=false.

-- Clean up
UPDATE podcasts SET share_token = NULL WHERE id = '<parent-uuid>';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00022_share_token.sql
git commit -m "$(cat <<'EOF'
feat(db): add share_token column and get_shared_tree RPC

Migration 00022 introduces public share-link support. share_token
is nullable on podcasts with a unique partial index; the
get_shared_tree RPC walks the expansion subtree in one round-trip
and is restricted to service_role.
EOF
)"
```

### Task 2: Mobile usePodcasts reads share_token through the layer

**Files:**
- Modify: `mobile/src/hooks/usePodcasts.ts`

- [ ] **Step 1: Add share_token to the row + camelCase shape**

Open `mobile/src/hooks/usePodcasts.ts`. In `PodcastRow`, add:

```ts
share_token: string | null;
```

just before `clarifying_answers`. In `Podcast`, add:

```ts
shareToken: string | null;
```

just before `clarifyingAnswers`.

- [ ] **Step 2: Add it to toPodcast**

In `toPodcast`, after `sourceChapterTitle: row.source_chapter_title,` and before `clarifyingAnswers: ...`:

```ts
shareToken: row.share_token,
```

- [ ] **Step 3: Add share_token to the Supabase select**

Find the `.from("podcasts").select(...)` call (there are a few). Add `share_token` to the column list of every select whose rows pass through `toPodcast`.

```bash
grep -n "\.select(" "/Users/isuru/personal/AI Podcast App/mobile/src/hooks/usePodcasts.ts"
```

For each select that returns rows mapped through `toPodcast`, add `share_token` to the comma-separated column list. If the existing select uses `select("*")`, leave it.

**Note (no updateShareToken helper):** A previous draft of this plan added an `updateShareToken` cache helper on `usePodcasts`. We dropped it because the player screen (`mobile/app/player/[id]/index.tsx:53-62`) fetches its own row via `.from("podcasts").select("*").eq("id", id).single()` and stores the result in a local `useState<Podcast | null>`. It never reads from the hook's array. The ShareNavRow's `onTokenIssued` callback writes to that local `setPodcast` directly (see Chunk 4 Task 14), so any helper on the hook would be dead code.

- [ ] **Step 4: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/hooks/usePodcasts.ts
git commit -m "$(cat <<'EOF'
feat(mobile): thread share_token through usePodcasts

Adds share_token to the row and shareToken to the app-level Podcast
shape with a corresponding mapper update.
EOF
)"
```

### Task 3: Regenerate or hand-edit mobile/src/types/database.ts

**Files:**
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Try regenerating types via Supabase CLI**

```bash
cd "/Users/isuru/personal/AI Podcast App" && npx supabase gen types typescript --project-id "$(grep -oE 'project[_-]id\s*=\s*\"[^\"]+\"' supabase/config.toml | head -1 | cut -d'"' -f2)" --schema public > mobile/src/types/database.ts.new
```

If the command succeeds and the output looks well-formed, replace the file. If the CLI isn't logged in or the project id grep fails, fall back to step 2.

- [ ] **Step 2 (fallback): Hand-edit database.ts**

Open `mobile/src/types/database.ts`. Find the `podcasts` table type block (Row, Insert, Update). Add to each:

```ts
share_token: string | null;
```

For `Insert` and `Update`, make it optional (`share_token?: string | null;`). Add anywhere alphabetical or after `parent_podcast_id`.

Also add the `get_shared_tree` function signature under the `Functions` block:

```ts
get_shared_tree: {
  Args: { p_token: string };
  Returns: {
    id: string;
    user_id: string;
    parent_podcast_id: string | null;
    topic: string;
    has_cover: boolean;
    chapter_markers: Json;
    duration_seconds: number | null;
    status: string;
    is_root: boolean;
  }[];
};
```

- [ ] **Step 3: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/types/database.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add share_token + get_shared_tree to generated types
EOF
)"
```

---

## Chunk 2: Pipeline issue-token endpoint

A new authed route on the Hono server that issues (or returns existing) share tokens for podcasts the caller owns. The route lives at `POST /api/share-podcast/:podcastId`.

### Task 4: Scaffold issueShareToken route + happy-path test

**Files:**
- Create: `pipeline/src/routes/issueShareToken.ts`
- Create: `pipeline/tests/issueShareToken.test.ts`

- [ ] **Step 1: Create the route file skeleton**

Create `pipeline/src/routes/issueShareToken.ts`:

```ts
/**
 * POST /api/share-podcast/:podcastId
 *
 * Issues a public share token for a podcast the caller owns. Idempotent:
 * if a token already exists, the same token is returned. Token format is
 * 10-char base64url from 7 random bytes (~7.2e16 keyspace). Writes go
 * through the service-role client because the podcasts RLS UPDATE policy
 * is locked to soft-delete only (migration 00007).
 *
 * Auth: userAuth (Supabase JWT)
 * Errors: 401 (no JWT), 403 (not owner), 404 (podcast not found),
 *         409 (status != 'complete'), 500 (unique-violation retried)
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { userAuth } from "../middleware/auth.js";

function generateToken(): string {
  return randomBytes(7).toString("base64url");
}

const route = new Hono();

route.post("/:podcastId", userAuth, async (c) => {
  const podcastId = c.req.param("podcastId");
  const user = c.get("user");

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: podcast, error: lookupErr } = await supabase
    .from("podcasts")
    .select("id, user_id, status, deleted_at, share_token")
    .eq("id", podcastId)
    .maybeSingle();

  if (lookupErr) return c.json({ error: "lookup failed" }, 500);
  if (!podcast || podcast.deleted_at) return c.json({ error: "not found" }, 404);
  if (podcast.user_id !== user.id) return c.json({ error: "forbidden" }, 403);
  if (podcast.status !== "complete") return c.json({ error: "not ready" }, 409);
  if (podcast.share_token) return c.json({ token: podcast.share_token });

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = generateToken();
    const { error: updateErr, count } = await supabase
      .from("podcasts")
      .update({ share_token: token }, { count: "exact" })
      .eq("id", podcastId)
      .is("share_token", null);

    if (updateErr) {
      // Unique violation: another caller raced and won, OR the impossibly
      // unlikely random collision. Re-read and return whichever won; if
      // share_token is still null, try once more.
      if (updateErr.code === "23505") continue;
      return c.json({ error: "issue failed" }, 500);
    }

    if (count === 0) {
      // Row matched a different filter (race lost between SELECT and UPDATE).
      const { data: fresh } = await supabase
        .from("podcasts")
        .select("share_token")
        .eq("id", podcastId)
        .maybeSingle();
      if (fresh?.share_token) return c.json({ token: fresh.share_token });
      continue;
    }

    return c.json({ token });
  }

  return c.json({ error: "issue failed" }, 500);
});

export { route as issueShareTokenRoute };
```

- [ ] **Step 2: Write the failing happy-path test**

Create `pipeline/tests/issueShareToken.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

// Mock userAuth to attach a deterministic user without touching real Supabase.
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
});
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd pipeline && npx vitest run tests/issueShareToken.test.ts
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add pipeline/src/routes/issueShareToken.ts pipeline/tests/issueShareToken.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): add POST /api/share-podcast issue-token route

Service-role-backed endpoint that issues idempotent share tokens
for podcasts the caller owns. Token is 10-char base64url from 7
random bytes. Race-safe via the WHERE share_token IS NULL clause.
EOF
)"
```

### Task 5: Reject non-owners (403) and in-flight podcasts (409)

**Files:**
- Modify: `pipeline/tests/issueShareToken.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `issueShareToken.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests**

```bash
cd pipeline && npx vitest run tests/issueShareToken.test.ts
```

Expected: 5 passed. If any fail, the route logic in Task 4 already covers these branches, so the failure is likely a mock-builder issue; debug from there.

- [ ] **Step 3: Commit**

```bash
git add pipeline/tests/issueShareToken.test.ts
git commit -m "$(cat <<'EOF'
test(pipeline): cover share-token 403, 404, 409 branches
EOF
)"
```

### Task 6: Idempotency and race tests

**Files:**
- Modify: `pipeline/tests/issueShareToken.test.ts`

- [ ] **Step 1: Add idempotency + race tests**

Append:

```ts
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
```

- [ ] **Step 2: Run tests**

```bash
cd pipeline && npx vitest run tests/issueShareToken.test.ts
```

Expected: 7 passed.

- [ ] **Step 3: Commit**

```bash
git add pipeline/tests/issueShareToken.test.ts
git commit -m "$(cat <<'EOF'
test(pipeline): share-token idempotency + race-on-update
EOF
)"
```

### Task 7: Mount the route in server.ts

**Files:**
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Wire the route**

Open `pipeline/src/server.ts`. Add the import next to the others:

```ts
import { issueShareTokenRoute } from "./routes/issueShareToken.js";
```

Add the mount line near the other `/api/*` mounts:

```ts
app.route("/api/share-podcast", issueShareTokenRoute);
```

- [ ] **Step 2: Run typecheck**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke-test against a local dev server**

```bash
cd pipeline && npx tsx watch src/server.ts &
SERVER_PID=$!
sleep 2
# Fetch a real user JWT and podcast id from your dev DB before running this.
curl -i -X POST -H "Authorization: Bearer <YOUR_JWT>" http://localhost:3000/api/share-podcast/<PODCAST_ID>
kill $SERVER_PID
```

Expected: 200 with `{"token":"..."}` on first call, same token on the second call. 403 if `user_id` differs. 401 with no header.

- [ ] **Step 4: Commit**

```bash
git add pipeline/src/server.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): mount /api/share-podcast in server.ts
EOF
)"
```

---

## Chunk 3: Pipeline public share page

This chunk lands the public `GET /p/:token` route, the HTML template, and the static asset directory. By the end of this chunk a share link opens a working page when given a token issued by chunk 2.

### Task 8: Static assets directory and serveStatic mount

**Files:**
- Create: `pipeline/public/og/default.png` (placeholder, replace with real asset before launch)
- Create: `pipeline/public/og/app-store.svg` (placeholder)
- Create: `pipeline/public/og/play-store.svg` (placeholder)
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Create the public directory with placeholders**

```bash
mkdir -p "/Users/isuru/personal/AI Podcast App/pipeline/public/og"
# 1x1 transparent PNG as a placeholder; real 1200x630 art ships before launch.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\xdac\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\xc6\xfb\xb5\x00\x00\x00\x00IEND\xaeB`\x82' > "/Users/isuru/personal/AI Podcast App/pipeline/public/og/default.png"
# Empty SVG stubs.
printf '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#1A1B1F"/><text x="60" y="25" fill="#FBF8F1" font-family="sans-serif" font-size="11" text-anchor="middle">App Store</text></svg>' > "/Users/isuru/personal/AI Podcast App/pipeline/public/og/app-store.svg"
printf '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#1A1B1F"/><text x="60" y="25" fill="#FBF8F1" font-family="sans-serif" font-size="11" text-anchor="middle">Google Play</text></svg>' > "/Users/isuru/personal/AI Podcast App/pipeline/public/og/play-store.svg"
```

- [ ] **Step 2: Mount serveStatic in server.ts**

In `pipeline/src/server.ts`, add the import (note the explicit `.js` extension to match the project's other imports):

```ts
import { serveStatic } from "@hono/node-server/serve-static";
```

Add the mount **before** the `/api/*` routes so static asset matches don't fall into route handlers:

```ts
app.use("/og/*", serveStatic({ root: "./public" }));
```

- [ ] **Step 3: Smoke-test the static serving**

```bash
cd pipeline && npx tsx watch src/server.ts &
SERVER_PID=$!
sleep 2
curl -i http://localhost:3000/og/app-store.svg
kill $SERVER_PID
```

Expected: 200 with `Content-Type: image/svg+xml` and the SVG body.

- [ ] **Step 4: Commit**

```bash
git add pipeline/public/og/ pipeline/src/server.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): serve /og/* static assets for the share page

Adds placeholder default.png + store badges and mounts serveStatic
from @hono/node-server. Replace placeholders with real assets
before launch.
EOF
)"
```

### Task 9: Share page route (404 path first)

**Files:**
- Create: `pipeline/src/routes/sharePage.ts`
- Create: `pipeline/tests/sharePage.test.ts`
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Scaffold the route**

Create `pipeline/src/routes/sharePage.ts`:

```ts
/**
 * GET /p/:token
 *
 * Public share page. No auth. Looks up the podcast subtree via the
 * get_shared_tree RPC (service_role only), rebuilds Storage paths
 * from user_id + podcast id, signs them with a 1-hour TTL, and
 * renders an HTML page in a single template string.
 *
 * NEVER queries research_contexts, citations, or qa_sessions. The
 * sharePage.test.ts asserts this with a Supabase mock.
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

const route = new Hono();

route.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.html(renderNotFound(), 404);

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tree, error } = await supabase.rpc("get_shared_tree", { p_token: token });
  if (error || !tree || tree.length === 0) {
    return c.html(renderNotFound(), 404);
  }

  // TODO Task 10: sign URLs, render full template.
  return c.html("<!doctype html><title>placeholder</title>");
});

function renderNotFound(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found · Katavo</title>
<meta name="robots" content="noindex,nofollow">
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#FBF8F1;color:#1A1B1F;padding:24px;text-align:center}</style>
</head>
<body>
  <main>
    <h1>This podcast isn't available.</h1>
    <p>The link may have expired or the podcast was removed.</p>
    <!-- Brand link omitted until custom domain ships. -->
    <p>Made with Katavo.</p>
  </main>
</body>
</html>`;
}

export { route as sharePageRoute };
```

- [ ] **Step 2: Mount it in server.ts**

In `pipeline/src/server.ts`:

```ts
import { sharePageRoute } from "./routes/sharePage.js";
// ...
app.route("/p", sharePageRoute);
```

Mount AFTER the `/og/*` static mount and AFTER all `/api/*` routes (order doesn't matter functionally since `/p/:token` has a unique prefix; grouping with the other public routes is just convention).

- [ ] **Step 3: Write the 404 test**

Create `pipeline/tests/sharePage.test.ts`:

```ts
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
});
```

- [ ] **Step 4: Run the tests**

```bash
cd pipeline && npx vitest run tests/sharePage.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/routes/sharePage.ts pipeline/tests/sharePage.test.ts pipeline/src/server.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): scaffold GET /p/:token with 404 handling

Wires the route, mounts it on the public path, and lands the
not-found HTML response. Full template + signed URL rendering
lands in the next task.
EOF
)"
```

### Task 10: Sign URLs and render the full template

**Files:**
- Create: `pipeline/src/routes/shareTemplate.ts`
- Modify: `pipeline/src/routes/sharePage.ts`
- Modify: `pipeline/tests/sharePage.test.ts`

- [ ] **Step 1: Write the template helper**

Create `pipeline/src/routes/shareTemplate.ts`:

```ts
/**
 * HTML template for the share page. Pure: takes already-signed
 * URLs and serializable values, returns a string. No I/O. All
 * user-supplied text is HTML-escaped; the inline JSON blob has
 * its `</script>` escape applied to prevent script breakout.
 */

const STORE_APP = "https://apps.apple.com/app/katavo/id0000000000"; // TODO real id
const STORE_PLAY = "https://play.google.com/store/apps/details?id=co.katavo.app";

export interface ShareEpisode {
  id: string;
  topic: string;
  durationSeconds: number | null;
  chapters: { timestampSeconds: number; title: string }[];
  audioUrl: string;
  coverUrl: string | null;
}

export interface ShareTemplateInput {
  shareUrl: string;
  root: ShareEpisode;
  descendants: ShareEpisode[]; // ordered by created_at ascending
  defaultOgImage: string; // absolute URL to /og/default.png
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function formatMinutes(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function renderSharePage(input: ShareTemplateInput): string {
  const { root, descendants, shareUrl, defaultOgImage } = input;
  const ogImage = root.coverUrl ?? defaultOgImage;
  const episodesBlob = escapeScriptJson({
    [root.id]: {
      topic: root.topic,
      chapters: root.chapters,
      audioUrl: root.audioUrl,
      durationLabel: formatMinutes(root.durationSeconds),
    },
    ...Object.fromEntries(
      descendants.map((d) => [
        d.id,
        {
          topic: d.topic,
          chapters: d.chapters,
          audioUrl: d.audioUrl,
          durationLabel: formatMinutes(d.durationSeconds),
        },
      ]),
    ),
  });

  const chapterItems = root.chapters
    .map(
      (ch) =>
        `<li><button type="button" data-seek="${ch.timestampSeconds}"><span class="ts">${formatTimestamp(
          ch.timestampSeconds,
        )}</span> ${htmlEscape(ch.title)}</button></li>`,
    )
    .join("\n          ");

  const seriesSection = descendants.length
    ? `
      <section class="series">
        <h2 class="eyebrow">More from this series</h2>
        <ul>
          ${descendants
            .map(
              (d) =>
                `<li><button type="button" data-episode="${htmlEscape(d.id)}">${htmlEscape(
                  d.topic,
                )} <span class="meta">${formatMinutes(d.durationSeconds)}</span></button></li>`,
            )
            .join("\n          ")}
        </ul>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(root.topic)} · Katavo</title>
    <meta name="robots" content="noindex,nofollow" />

    <meta property="og:title" content="${htmlEscape(root.topic)}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${htmlEscape(ogImage)}" />
    <meta property="og:url" content="${htmlEscape(shareUrl)}" />
    <meta property="og:description" content="Listen to this Katavo episode." />
    <meta property="og:audio" content="${htmlEscape(root.audioUrl)}" />
    <meta property="og:audio:type" content="audio/mpeg" />
    <!-- og:audio rots after the 1h signed URL TTL; the in-page <audio>
         re-signs on each page render and works forever. Acceptable
         trade-off so messaging apps that inline-play (iMessage) work
         on first share. -->


    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${htmlEscape(root.topic)}" />
    <meta name="twitter:image" content="${htmlEscape(ogImage)}" />

    <style>
      :root{--paper:#FBF8F1;--ink:#1A1B1F;--ink-2:#84858C;--hair:#E8E2D2;--accent:#2D5040;}
      *,*::before,*::after{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--paper);color:var(--ink);line-height:1.5}
      header{padding:24px;border-bottom:1px solid var(--hair)}
      header .brand{font-weight:600;letter-spacing:0.3px}
      main{max-width:680px;margin:0 auto;padding:32px 24px 96px}
      .cover{aspect-ratio:1;width:100%;max-width:320px;border-radius:12px;background:var(--hair);object-fit:cover;display:block;margin:0 0 24px}
      .topic{font-family:Georgia,"IBM Plex Serif",serif;font-size:32px;line-height:1.15;margin:0 0 8px}
      .meta-row{color:var(--ink-2);font-size:14px;margin:0 0 24px}
      audio{width:100%;margin:0 0 32px}
      .eyebrow{font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 12px}
      section.chapters ol,section.series ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
      section.chapters button,section.series button{appearance:none;background:none;border:0;color:var(--ink);text-align:left;width:100%;padding:12px 0;border-bottom:1px solid var(--hair);font:inherit;cursor:pointer}
      section.chapters .ts{display:inline-block;min-width:48px;color:var(--ink-2);font-variant-numeric:tabular-nums}
      section.series{margin-top:48px}
      section.series .meta{color:var(--ink-2);font-size:13px}
      footer{border-top:1px solid var(--hair);padding:32px 24px;text-align:center;color:var(--ink-2)}
      footer p{margin:0 0 16px}
      footer .badges{display:flex;gap:12px;justify-content:center}
      footer img{height:40px}
    </style>
  </head>
  <body>
    <header><span class="brand">Katavo</span></header>
    <main>
      ${root.coverUrl ? `<img class="cover" src="${htmlEscape(root.coverUrl)}" alt="${htmlEscape(root.topic)} cover" />` : ""}
      <h1 class="topic" id="topic">${htmlEscape(root.topic)}</h1>
      <p class="meta-row" id="meta-row">${formatMinutes(root.durationSeconds)} · ${root.chapters.length} chapters</p>
      <audio id="player" controls preload="metadata" src="${htmlEscape(root.audioUrl)}"></audio>

      <section class="chapters">
        <h2 class="eyebrow">Chapters</h2>
        <ol id="chapter-list">
          ${chapterItems}
        </ol>
      </section>
      ${seriesSection}
    </main>
    <footer>
      <p>Made with Katavo. Generate your own.</p>
      <div class="badges">
        <a href="${STORE_APP}"><img src="/og/app-store.svg" alt="Download on the App Store" /></a>
        <a href="${STORE_PLAY}"><img src="/og/play-store.svg" alt="Get it on Google Play" /></a>
      </div>
    </footer>
    <script>
      window.__EPISODES__ = ${episodesBlob};
      (function () {
        var audio = document.getElementById("player");
        var list = document.getElementById("chapter-list");
        var topicEl = document.getElementById("topic");
        var metaEl = document.getElementById("meta-row");

        function escapeHtml(s) {
          return s.replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
          });
        }
        function fmt(t) {
          var m = Math.floor(t / 60), s = Math.floor(t % 60);
          return m + ":" + (s < 10 ? "0" + s : s);
        }
        function renderChapters(chapters) {
          list.innerHTML = chapters
            .map(function (ch) {
              return '<li><button type="button" data-seek="' + ch.timestampSeconds + '"><span class="ts">' +
                fmt(ch.timestampSeconds) + '</span> ' + escapeHtml(ch.title) + '</button></li>';
            })
            .join("");
        }
        document.addEventListener("click", function (ev) {
          var t = ev.target.closest("[data-seek]");
          if (t) {
            audio.currentTime = parseFloat(t.getAttribute("data-seek"));
            audio.play();
            return;
          }
          var ep = ev.target.closest("[data-episode]");
          if (ep) {
            var id = ep.getAttribute("data-episode");
            var data = window.__EPISODES__[id];
            if (!data) return;
            audio.pause();
            audio.src = data.audioUrl;
            audio.load();
            renderChapters(data.chapters);
            topicEl.textContent = data.topic;
            metaEl.textContent = data.durationLabel + " · " + data.chapters.length + " chapters";
            document.title = data.topic + " · Katavo";
            window.scrollTo(0, 0);
          }
        });
      })();
    </script>
  </body>
</html>`;
}
```

- [ ] **Step 2: Wire the template into the route**

Replace the placeholder in `pipeline/src/routes/sharePage.ts`:

```ts
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { renderSharePage, type ShareEpisode } from "./shareTemplate.js";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const route = new Hono();

route.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.html(renderNotFound(), 404);

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: tree, error } = await supabase.rpc("get_shared_tree", { p_token: token });
  if (error || !tree || tree.length === 0) {
    return c.html(renderNotFound(), 404);
  }

  const rootRow = tree.find((r: any) => r.is_root);
  if (!rootRow) return c.html(renderNotFound(), 404);
  const descendantRows = tree.filter((r: any) => !r.is_root);

  async function toEpisode(row: any): Promise<ShareEpisode | null> {
    const audioPath = `${row.user_id}/${row.id}.mp3`;
    const { data: audioSigned, error: audioErr } = await supabase
      .storage.from("podcast-audio")
      .createSignedUrl(audioPath, SIGNED_URL_TTL_SECONDS);
    if (audioErr || !audioSigned?.signedUrl) return null;

    let coverUrl: string | null = null;
    if (row.has_cover) {
      const coverPath = `${row.user_id}/${row.id}.png`;
      const { data: coverSigned } = await supabase
        .storage.from("podcast-covers")
        .createSignedUrl(coverPath, SIGNED_URL_TTL_SECONDS);
      coverUrl = coverSigned?.signedUrl ?? null;
    }
    return {
      id: row.id,
      topic: row.topic,
      durationSeconds: row.duration_seconds,
      chapters: Array.isArray(row.chapter_markers) ? row.chapter_markers : [],
      audioUrl: audioSigned.signedUrl,
      coverUrl,
    };
  }

  const root = await toEpisode(rootRow);
  if (!root) return c.html(renderNotFound(), 404);
  const descendants = (await Promise.all(descendantRows.map(toEpisode))).filter(
    (d): d is ShareEpisode => d !== null,
  );

  const shareBase = process.env.SHARE_PUBLIC_BASE_URL ?? `https://${c.req.header("host") ?? "katavo.co"}`;
  const shareUrl = `${shareBase}/p/${token}`;
  const defaultOgImage = `${shareBase}/og/default.png`;

  c.header("Cache-Control", "no-store");
  return c.html(renderSharePage({ shareUrl, root, descendants, defaultOgImage }));
});

function renderNotFound(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found · Katavo</title>
<meta name="robots" content="noindex,nofollow">
<style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#FBF8F1;color:#1A1B1F;padding:24px;text-align:center}</style>
</head>
<body>
  <main>
    <h1>This podcast isn't available.</h1>
    <p>The link may have expired or the podcast was removed.</p>
    <!-- Brand link omitted until custom domain ships. -->
    <p>Made with Katavo.</p>
  </main>
</body>
</html>`;
}

export { route as sharePageRoute };
```

- [ ] **Step 3: Add the happy-path test**

Append to `pipeline/tests/sharePage.test.ts`:

```ts
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
```

- [ ] **Step 4: Run all share page tests**

```bash
cd pipeline && npx vitest run tests/sharePage.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Manual end-to-end smoke**

```bash
cd pipeline && npx tsx watch src/server.ts &
SERVER_PID=$!
sleep 2
# Issue a token first (use a real owner JWT + podcast id):
TOKEN=$(curl -s -X POST -H "Authorization: Bearer <YOUR_JWT>" http://localhost:3000/api/share-podcast/<PODCAST_ID> | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
echo "Token: $TOKEN"
# Then fetch the page:
open "http://localhost:3000/p/$TOKEN"
kill $SERVER_PID
```

Expected: a browser tab opens the share page with cover, topic, audio controls, chapter list, footer.

Verify the rendered HTML embeds a fresh signed URL (not the column value):

```bash
curl -s "http://localhost:3000/p/$TOKEN" | grep -oE 'podcast-audio/[^"]+token=[^"]+' | head -1
```

Expected: a path like `podcast-audio/<user_id>/<podcast_id>.mp3?token=...` confirming `createSignedUrl` ran.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/routes/shareTemplate.ts pipeline/src/routes/sharePage.ts pipeline/tests/sharePage.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): render full share page with signed URLs

Per-render path reconstruction from user_id+id, 1h TTL signed URLs
for audio (and covers when has_cover), inline HTML template with
escaped topic + chapter list + episode-swap script. Cache-Control:
no-store. The route never touches research-side tables, asserted
by a Supabase mock that throws on .from().
EOF
)"
```

---

## Chunk 4: Mobile share button

This chunk extracts the shared `NavRow` primitive, refactors `ResearchNavRow` onto it, builds `ShareNavRow`, and mounts both on the player screen.

### Task 11: Extract shared NavRow primitive

**Files:**
- Create: `mobile/src/components/NavRow.tsx`

- [ ] **Step 1: Write the primitive**

Create `mobile/src/components/NavRow.tsx`:

```tsx
/**
 * Shared player-screen NavRow: divider + pressable row with
 * eyebrow, title, optional subtitle, and chevron. Used by
 * ResearchNavRow and ShareNavRow.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel: string;
}

export function NavRow({ eyebrow, title, subtitle, onPress, accessibilityLabel }: Props) {
  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <Feather name="chevron-right" size={20} color={color.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: color.hairline },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rowPressed: { opacity: 0.55 },
  body: { flex: 1, gap: space.xxs },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  title: { ...text.titleSerif, fontSize: 19, lineHeight: 26 },
  subtitle: { ...text.body, fontSize: 13, color: color.inkSecondary, marginTop: 2 },
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/NavRow.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): add shared NavRow primitive for player rows
EOF
)"
```

### Task 12: Refactor ResearchNavRow onto NavRow

**Files:**
- Modify: `mobile/src/components/ResearchNavRow.tsx`

- [ ] **Step 1: Rewrite the component**

Replace `mobile/src/components/ResearchNavRow.tsx` with:

```tsx
/**
 * ResearchNavRow, sits below the chapter list in the player.
 *
 * Tier-gated: free users see "Research · Plus" eyebrow and route to
 * /plans. Plus+ users see "Research" and route to the research screen.
 *
 * Hidden when podcastStatus !== "complete" (in-flight or failed
 * podcasts have no research to surface).
 */
import { useRouter } from "expo-router";
import { useSubscription } from "../hooks/useSubscription";
import { isFeatureUnlocked } from "../lib/tiers";
import { NavRow } from "./NavRow";

interface Props {
  podcastId: string;
  podcastStatus: string;
}

export function ResearchNavRow({ podcastId, podcastStatus }: Props) {
  const router = useRouter();
  const { subscription } = useSubscription();

  if (podcastStatus !== "complete") return null;

  const tier = subscription?.tier ?? "free";
  const unlocked = isFeatureUnlocked("research", tier);

  const onPress = () => {
    if (unlocked) {
      router.push(`/player/${podcastId}/research`);
    } else {
      router.push({ pathname: "/plans", params: { context: "research" } });
    }
  };

  return (
    <NavRow
      eyebrow="Research"
      title="Sources behind this episode"
      onPress={onPress}
      accessibilityLabel={
        unlocked
          ? "Open research and sources behind this episode"
          : "Sources behind this episode. Upgrade to access the research."
      }
    />
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Manual regression check**

Open the player on a Plus account, confirm the Research row still appears, taps still route to `/player/[id]/research`. Open on free, confirm it routes to `/plans?context=research`.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/ResearchNavRow.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): ResearchNavRow uses shared NavRow primitive
EOF
)"
```

### Task 13: ShareNavRow component

**Files:**
- Create: `mobile/src/components/ShareNavRow.tsx`

- [ ] **Step 1: Write the component**

Create `mobile/src/components/ShareNavRow.tsx`:

```tsx
/**
 * ShareNavRow, sits below ResearchNavRow on the player.
 *
 * Anyone (Free/Plus/Pro) can share a completed podcast via a public link.
 * Tap calls the issue-token endpoint (idempotent), then opens the native
 * share sheet. The NavRow subtitle states what becomes public so users
 * decide before the sheet opens. No confirmation modal.
 *
 * Hidden when podcastStatus !== "complete".
 */
import { useState } from "react";
import { Alert, Share } from "react-native";
import { supabase } from "../lib/supabase";
import { NavRow } from "./NavRow";

const API_URL = process.env.EXPO_PUBLIC_API_URL;
const SHARE_BASE = process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? API_URL;

interface Props {
  podcastId: string;
  podcastStatus: string;
  topic: string;
  shareToken: string | null;
  onTokenIssued: (token: string) => void;
}

export function ShareNavRow({
  podcastId,
  podcastStatus,
  topic,
  shareToken,
  onTokenIssued,
}: Props) {
  const [busy, setBusy] = useState(false);

  if (podcastStatus !== "complete") return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let token = shareToken;
      if (!token) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API_URL}/api/share-podcast/${podcastId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        if (!res.ok) throw new Error(`share failed: ${res.status}`);
        const body = await res.json();
        token = body.token as string;
        onTokenIssued(token);
      }
      const shareUrl = `${SHARE_BASE}/p/${token}`;
      await Share.share({
        url: shareUrl,
        message: `${topic}\n\n${shareUrl}`,
        title: topic,
      });
    } catch (err) {
      console.warn("ShareNavRow tap failed:", err);
      Alert.alert("Couldn't share", "Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NavRow
      eyebrow="Share"
      title={shareToken ? "Copy link" : "Share this episode"}
      subtitle={shareToken ? "Audio and chapters are public" : "Audio and chapters become public"}
      onPress={onPress}
      accessibilityLabel={
        shareToken
          ? "Share this podcast link"
          : "Generate a public link and share this podcast"
      }
    />
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ShareNavRow.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): ShareNavRow component

Tap calls the issue-token endpoint and opens the native share sheet.
Idempotent for already-shared podcasts. Error path surfaces a short
Alert and logs; no silent failure.
EOF
)"
```

### Task 14: Mount ShareNavRow on the player screen

**Files:**
- Modify: `mobile/app/player/[id]/index.tsx`

- [ ] **Step 1: Wire the component in**

In `mobile/app/player/[id]/index.tsx`:

1. Add the import next to ResearchNavRow's:

```ts
import { ShareNavRow } from "../../../src/components/ShareNavRow";
```

2. The player screen already has `podcast` (a `Podcast | null`) and `setPodcast` from its local `useState` (lines 44-62). After Chunk 1, `podcast.shareToken` is already populated by `toPodcast`. We use the local state setter to flip the NavRow's "Share this episode" / "Copy link" state after token issuance, since the player screen doesn't read from the `usePodcasts` array.

3. Insert the new row immediately after `<ResearchNavRow ... />` (around line 262):

```tsx
<ShareNavRow
  podcastId={String(id)}
  podcastStatus={podcast.status}
  topic={podcast.topic}
  shareToken={podcast.shareToken}
  onTokenIssued={(token) =>
    setPodcast((p) => (p ? { ...p, shareToken: token } : p))
  }
/>
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Manual smoke on a dev build**

Run the app against a dev pipeline server (Task 7 confirms the endpoint works locally). On a complete podcast:
- Tap Share. Native share sheet opens with the topic and the URL.
- Copy the URL, paste it into the browser, confirm the share page renders with audio + chapter list.
- Return to the app, the row now reads "Copy link" with the "are public" subtitle.
- Tap again, share sheet opens with the same URL (idempotent).

On an in-flight podcast: row is hidden.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/player/[id]/index.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): mount ShareNavRow under ResearchNavRow on the player
EOF
)"
```

### Task 15: Phase exit verification

- [ ] **Step 1: Pipeline test suite is clean**

```bash
cd pipeline && npm test
```

Expected: all green.

- [ ] **Step 2: Pipeline typecheck**

```bash
cd pipeline && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Mobile typecheck**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: End-to-end manual on real device**

Deploy the pipeline to Railway, point the mobile dev build at it. On a real device:
- Generate a podcast with a parent + 1 expansion.
- Tap Share on the parent. iMessage / Slack preview shows topic + cover.
- Open the link on a device WITHOUT the Katavo app installed. Audio plays. Chapter taps seek. Episode swap moves to the descendant; iOS Safari handles `audio.load()` correctly.
- Soft-delete the podcast from the owner's account. Re-open the link. 404.
- Restore (un-soft-delete) the podcast row. Re-open the link. Works again.
- Expand the parent again post-share. The new chapter appears on the share page on reload.

- [ ] **Step 5: Set `EXPO_PUBLIC_SHARE_BASE_URL` (operational)**

If/when a custom domain points at Railway, set `EXPO_PUBLIC_SHARE_BASE_URL` to that host in EAS and cut a new build. Until then the share base falls back to `EXPO_PUBLIC_API_URL`, which is already the live pipeline URL.

---

## Reverting

This work lands in chunks. Worst-case rollback:

1. Revert all commits from Chunk 1 onward: `git revert <range>`.
2. Drop the migration on a follow-up: `ALTER TABLE podcasts DROP COLUMN share_token; DROP FUNCTION public.get_shared_tree(text);` in a new migration.
3. Redeploy pipeline (Railway) and cut a new EAS build (mobile).

Existing share links return 404 cleanly once `GET /p/:token` is removed.
