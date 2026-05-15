# v21 — Shared Podcast Expansion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dead-end "Expand in app" CTA on the public share page into the central acquisition flow. Tapping it clones User A's tree (parent + all existing expansions) into User B's library and queues a new chapter expansion for one credit, with no onboarding, in the original voice. Two paths converge on the same backend: existing users on mobile open via Universal Link; new users sign in on the web share page and get handed a session via a single-use claim token.

**Architecture:** New endpoint `/api/share/clone-and-expand` runs a SECURITY DEFINER RPC (`clone_shared_tree`) that duplicates podcasts + research_contexts into the target user's account, then copies Storage blobs (audio/cover/transcript) to the new owner's namespace, then transactionally deducts one credit and inserts the new expansion row. For fresh signups (`auth.users.created_at` within 5 minutes of request entry) the endpoint sets `profile.onboarding_completed_at`, sets `profile.voice` to the cloned parent's voice, and issues a 90-day single-use session-claim JWT delivered via the response body + a transactional email. The mobile app exchanges that JWT at `/api/auth/claim-session` for a real Supabase session via `supabase.auth.admin.generateLink` magic-link flow. Universal Links handled via AASA + assetlinks.json served from the Hono server.

**Tech Stack:** Hono on Railway (existing), Supabase Postgres + Auth + Storage (existing), vitest for pipeline tests, React Native Expo Router for mobile, Resend for email (new dependency — deferrable to v2 if blocking).

**Spec:** `docs/superpowers/specs/2026-05-15-shared-podcast-expansion-design.md`

**Depends on:** v9 (onboarding gate + voice schema), v15/v16/v17 (chapter expansion pipeline + UX), v18 (voice propagation), v20 (share_token + get_shared_tree).

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/00023_clone_shared_tree.sql` | `cloned_from_share_token` column + idempotency index + same-chapter race-guard index + `clone_shared_tree` RPC |
| `supabase/migrations/00024_session_claim_tokens.sql` | Single-use claim token storage + cleanup index |
| `supabase/migrations/00025_push_prompted_at.sql` | `push_prompted_at` on profiles + backfill |
| `pipeline/src/lib/claimToken.ts` | JWT sign/verify helpers for the session-claim token |
| `pipeline/src/lib/storageCopy.ts` | Idempotent storage-copy helper used by clone-and-expand |
| `pipeline/src/lib/claimEmail.ts` | Resend-backed transactional email for "Open in app" link |
| `pipeline/src/routes/cloneAndExpand.ts` | `POST /api/share/clone-and-expand` |
| `pipeline/src/routes/claimSession.ts` | `POST /api/auth/claim-session` |
| `pipeline/src/routes/wellKnown.ts` | `GET /.well-known/apple-app-site-association` + `assetlinks.json` |
| `pipeline/src/jobs/claimTokensCleanup.ts` | Hourly sweep of expired unredeemed tokens |
| `pipeline/tests/cloneAndExpand.test.ts` | Endpoint tests |
| `pipeline/tests/claimSession.test.ts` | Endpoint tests |
| `pipeline/tests/wellKnown.test.ts` | AASA + assetlinks JSON shape |
| `pipeline/tests/claimToken.test.ts` | JWT sign/verify unit tests |
| `pipeline/tests/storageCopy.test.ts` | Copy idempotency tests |
| `pipeline/tests/claimTokensCleanup.test.ts` | Sweep logic |
| `mobile/app/expand/[share_token]/[chapter_index].tsx` | Deep-link handler screen (truth table) |
| `mobile/src/components/PushPermissionSheet.tsx` | One-time push permission prompt |
| `mobile/src/services/clone.ts` | Mobile API client for clone-and-expand + claim-session |
| `mobile/src/hooks/useDeepLinkContext.ts` | Persists share_token + chapter_index across the auth navigation |

### Modified files

| Path | What changes |
|---|---|
| `pipeline/src/server.ts` | Mount cloneAndExpand, claimSession, wellKnown routes; start cleanup cron |
| `pipeline/src/routes/shareTemplate.ts` | Modal becomes auth panel; State B + C rendering; Universal Link CTA generation |
| `pipeline/src/routes/sharePage.ts` | Pass through `chapter` query param and signed-in user state |
| `mobile/app.config.ts` | iOS `associatedDomains`; Android intentFilters for `/expand/*` |
| `mobile/app/_layout.tsx` | Wire `useDeepLinkContext` to survive the auth navigation |
| `mobile/app/player/[id]/index.tsx` | Mount PushPermissionSheet on cooking view |
| `mobile/src/hooks/useProfile.ts` | Read `push_prompted_at` |
| `mobile/src/types/database.ts` | Regenerate or hand-edit for new columns |
| `pipeline/package.json` | Add `jose` (JWT) + `resend` deps |

---

## Chunk 1: Database migrations and clone RPC

This chunk lands the three migrations and the SECURITY DEFINER RPC. After this chunk: the DB can clone shared trees by direct SQL call; nothing else uses it yet. We verify with smoke tests against a real podcast tree.

### Task 1: Pre-migration audit for same-chapter duplicates

**Files:**
- None (audit-only)

- [ ] **Step 1: Run the audit query**

Use `mcp__supabase__execute_sql`:

```sql
SELECT parent_podcast_id, source_chapter_title, COUNT(*) AS dup_count
FROM public.podcasts
WHERE parent_podcast_id IS NOT NULL
  AND source_chapter_title IS NOT NULL
  AND deleted_at IS NULL
GROUP BY 1, 2
HAVING COUNT(*) > 1;
```

Expected: zero rows. The same-chapter unique index added in migration 00023 will fail to create if duplicates exist.

- [ ] **Step 2: If non-zero, surface to the user**

If the query returned rows, halt the plan and ask the user how to resolve. Likely options: soft-delete the older duplicates (`UPDATE podcasts SET deleted_at = now() WHERE id IN (...)`), or scope the unique index to exclude `cloned_from_share_token IS NULL` rows (changes the design — needs human review). Do not proceed until duplicates are gone.

### Task 2: Migration 00023 — clone token, indexes, RPC

**Files:**
- Create: `supabase/migrations/00023_clone_shared_tree.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00023_clone_shared_tree.sql
-- Adds support for cloning a shared podcast tree into another user's
-- account. The clone_shared_tree RPC walks the source tree (root +
-- descendants reachable via share_token) and INSERTs duplicates owned
-- by the target user, then duplicates the matching research_contexts
-- rows so the new owner can re-expand chapters independently.
--
-- Two unique partial indexes back the design:
--   1. podcasts_clone_idempotency — one root clone per (user, source token)
--   2. podcasts_one_expansion_per_chapter — race-guard against two
--      concurrent expansions targeting the same chapter on the same
--      parent (applies to all parents, not just cloned ones)

ALTER TABLE public.podcasts
  ADD COLUMN cloned_from_share_token text;

CREATE UNIQUE INDEX podcasts_clone_idempotency
  ON public.podcasts (user_id, cloned_from_share_token)
  WHERE cloned_from_share_token IS NOT NULL
    AND parent_podcast_id IS NULL;

CREATE UNIQUE INDEX podcasts_one_expansion_per_chapter
  ON public.podcasts (parent_podcast_id, source_chapter_title)
  WHERE parent_podcast_id IS NOT NULL
    AND source_chapter_title IS NOT NULL
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.clone_shared_tree(
  p_share_token text,
  p_target_user_id uuid
)
RETURNS TABLE (
  cloned_parent_id uuid,
  cloned_descendant_ids uuid[],
  descendant_source_chapters text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_parent uuid;
  v_descendant_ids uuid[] := ARRAY[]::uuid[];
  v_descendant_chapters text[] := ARRAY[]::text[];
  v_id_map jsonb := '{}'::jsonb;
  v_source record;
  v_new_id uuid;
  v_new_parent uuid;
BEGIN
  -- Idempotency: if this user already cloned this token, return the
  -- existing tree without re-inserting anything.
  SELECT id INTO v_existing_parent
  FROM podcasts
  WHERE user_id = p_target_user_id
    AND cloned_from_share_token = p_share_token
    AND parent_podcast_id IS NULL;

  IF v_existing_parent IS NOT NULL THEN
    SELECT
      COALESCE(array_agg(id ORDER BY created_at), ARRAY[]::uuid[]),
      COALESCE(array_agg(source_chapter_title ORDER BY created_at), ARRAY[]::text[])
    INTO v_descendant_ids, v_descendant_chapters
    FROM podcasts
    WHERE user_id = p_target_user_id
      AND cloned_from_share_token = p_share_token
      AND parent_podcast_id IS NOT NULL;
    cloned_parent_id := v_existing_parent;
    cloned_descendant_ids := v_descendant_ids;
    descendant_source_chapters := v_descendant_chapters;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Walk the source tree (same recursion as get_shared_tree from 00022)
  -- and INSERT clones. We insert in topological order (root first, then
  -- children) so parent_podcast_id can be remapped through v_id_map.
  FOR v_source IN
    WITH RECURSIVE tree AS (
      SELECT
        p.id, p.user_id, p.parent_podcast_id, p.topic, p.voice,
        p.audio_url, p.transcript_url, p.cover_url,
        p.chapter_markers, p.duration_seconds,
        p.source_chapter_title, p.status, p.created_at,
        true AS is_root, 0 AS depth
      FROM podcasts p
      WHERE p.share_token = p_share_token
        AND p.deleted_at IS NULL
        AND p.status = 'complete'
      UNION ALL
      SELECT
        p.id, p.user_id, p.parent_podcast_id, p.topic, p.voice,
        p.audio_url, p.transcript_url, p.cover_url,
        p.chapter_markers, p.duration_seconds,
        p.source_chapter_title, p.status, p.created_at,
        false AS is_root, t.depth + 1
      FROM podcasts p
      INNER JOIN tree t ON p.parent_podcast_id = t.id
      WHERE p.deleted_at IS NULL
        AND p.status = 'complete'
    )
    SELECT * FROM tree ORDER BY depth, created_at
  LOOP
    -- First iteration must be the root; if no rows at all the share
    -- token is invalid or revoked.
    v_new_id := gen_random_uuid();
    v_id_map := v_id_map || jsonb_build_object(v_source.id::text, v_new_id::text);
    v_new_parent := NULL;
    IF v_source.parent_podcast_id IS NOT NULL THEN
      v_new_parent := (v_id_map ->> v_source.parent_podcast_id::text)::uuid;
    END IF;

    INSERT INTO podcasts (
      id, user_id, parent_podcast_id, topic, voice,
      audio_url, transcript_url, cover_url,
      chapter_markers, duration_seconds,
      source_chapter_title, status,
      cloned_from_share_token
    ) VALUES (
      v_new_id, p_target_user_id, v_new_parent, v_source.topic, v_source.voice,
      v_source.audio_url, v_source.transcript_url, v_source.cover_url,
      v_source.chapter_markers, v_source.duration_seconds,
      v_source.source_chapter_title, 'complete',
      p_share_token
    );

    -- Duplicate the research_contexts row for this podcast so the new
    -- owner can re-expand chapters without depending on User A's data.
    INSERT INTO research_contexts (
      podcast_id, research_document, sources, chapter_research_map
    )
    SELECT v_new_id, rc.research_document, rc.sources, rc.chapter_research_map
    FROM research_contexts rc
    WHERE rc.podcast_id = v_source.id;

    IF v_source.is_root THEN
      cloned_parent_id := v_new_id;
    ELSE
      v_descendant_ids := v_descendant_ids || v_new_id;
      v_descendant_chapters := v_descendant_chapters || v_source.source_chapter_title;
    END IF;
  END LOOP;

  -- No root found means the share token is revoked or never existed.
  IF cloned_parent_id IS NULL THEN
    RAISE EXCEPTION 'share_revoked' USING ERRCODE = 'P0001';
  END IF;

  cloned_descendant_ids := v_descendant_ids;
  descendant_source_chapters := v_descendant_chapters;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_shared_tree(text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_shared_tree(text, uuid)
  TO service_role;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00023_clone_shared_tree` and the SQL above. Confirm via `mcp__supabase__list_migrations` that the row appears.

- [ ] **Step 3: Verify column, indexes, and RPC exist**

Run via `mcp__supabase__execute_sql`:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'podcasts'
  AND column_name = 'cloned_from_share_token';
-- Expected: 1 row, data_type = 'text'

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'podcasts'
  AND indexname IN ('podcasts_clone_idempotency', 'podcasts_one_expansion_per_chapter');
-- Expected: 2 rows

SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'clone_shared_tree';
-- Expected: 1 row, prosecdef = true

SELECT has_function_privilege('anon', 'public.clone_shared_tree(text, uuid)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.clone_shared_tree(text, uuid)', 'EXECUTE'),
       has_function_privilege('service_role', 'public.clone_shared_tree(text, uuid)', 'EXECUTE');
-- Expected: false, false, true
```

- [ ] **Step 4: Smoke-test the RPC on a real shared tree**

Pick a real complete podcast with a share_token and a child expansion (use `mcp__supabase__execute_sql`):

```sql
SELECT id, parent_podcast_id, share_token
FROM podcasts
WHERE share_token IS NOT NULL
  AND parent_podcast_id IS NULL
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 3;
```

Pick a real test user_id from `auth.users` (the developer's account), then call:

```sql
-- Replace <token> and <user_id> with real values
SELECT * FROM public.clone_shared_tree('<token>', '<user_id>'::uuid);
-- Expected: 1 row with cloned_parent_id (new uuid), cloned_descendant_ids (array),
-- descendant_source_chapters (array same length)
```

Verify the cloned tree shape:

```sql
SELECT id, parent_podcast_id, source_chapter_title, cloned_from_share_token
FROM podcasts
WHERE user_id = '<user_id>'::uuid
  AND cloned_from_share_token = '<token>';
-- Expected: parent row + all descendants, each with cloned_from_share_token set
```

Call the RPC a second time with same args — confirm idempotency returns the existing ids without duplicating rows.

- [ ] **Step 5: Clean up test data**

```sql
DELETE FROM research_contexts WHERE podcast_id IN (
  SELECT id FROM podcasts WHERE cloned_from_share_token = '<token>' AND user_id = '<user_id>'::uuid
);
DELETE FROM podcasts WHERE cloned_from_share_token = '<token>' AND user_id = '<user_id>'::uuid;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00023_clone_shared_tree.sql
git commit -m "$(cat <<'EOF'
feat(db): clone_shared_tree RPC + idempotency and race indexes

Adds cloned_from_share_token column on podcasts, a partial unique
index enforcing one root clone per (user, source token), and a
second partial unique index preventing two concurrent expansions of
the same chapter on the same parent (cloned or original).

The SECURITY DEFINER clone_shared_tree RPC walks the source tree in
topological order, INSERTs duplicates owned by the target user, and
copies the matching research_contexts rows. Returns the new root id
plus arrays of descendant ids and their source chapter titles for
the endpoint's chapter-dedup check.
EOF
)"
```

### Task 3: Migration 00024 — session_claim_tokens

**Files:**
- Create: `supabase/migrations/00024_session_claim_tokens.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00024_session_claim_tokens.sql
-- Storage for single-use session-claim JWTs. The pipeline server signs
-- a JWT (jose lib), stamps a row here at issue time, and atomically
-- updates redeemed_at at claim time. Concurrent redeem attempts race
-- on the UPDATE — only one wins.

CREATE TABLE public.session_claim_tokens (
  id          uuid primary key default gen_random_uuid(),
  jti         uuid unique not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_at timestamptz
);

CREATE INDEX session_claim_tokens_expires_at_idx
  ON public.session_claim_tokens (expires_at)
  WHERE redeemed_at IS NULL;

ALTER TABLE public.session_claim_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS, anon/authenticated denied.
REVOKE ALL ON public.session_claim_tokens FROM anon, authenticated;
GRANT ALL ON public.session_claim_tokens TO service_role;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00024_session_claim_tokens`.

- [ ] **Step 3: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'session_claim_tokens';
-- Expected: 1 row

SELECT has_table_privilege('anon', 'public.session_claim_tokens', 'SELECT'),
       has_table_privilege('authenticated', 'public.session_claim_tokens', 'SELECT'),
       has_table_privilege('service_role', 'public.session_claim_tokens', 'SELECT');
-- Expected: false, false, true
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00024_session_claim_tokens.sql
git commit -m "$(cat <<'EOF'
feat(db): session_claim_tokens table for single-use session handoff

JWTs minted by /api/share/clone-and-expand are recorded here at
issue time and atomically marked redeemed at claim time. RLS denies
anon/authenticated; only service_role touches the table. Partial
index on expires_at backs the hourly cleanup job.
EOF
)"
```

### Task 4: Migration 00025 — push_prompted_at with backfill

**Files:**
- Create: `supabase/migrations/00025_push_prompted_at.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00025_push_prompted_at.sql
-- Gate for the "We'll ping you when your podcast is ready" sheet that
-- appears on the cooking view for users coming through a shared link.
-- Backfilled for users who already completed onboarding (they were
-- prompted in v9 and shouldn't see the sheet a second time).

ALTER TABLE public.profiles
  ADD COLUMN push_prompted_at timestamptz;

UPDATE public.profiles
   SET push_prompted_at = now()
 WHERE onboarding_completed_at IS NOT NULL
   AND push_prompted_at IS NULL;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00025_push_prompted_at`.

- [ ] **Step 3: Verify backfill**

```sql
SELECT
  COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL AND push_prompted_at IS NULL) AS missed,
  COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL AND push_prompted_at IS NOT NULL) AS backfilled,
  COUNT(*) FILTER (WHERE onboarding_completed_at IS NULL AND push_prompted_at IS NULL) AS will_be_prompted
FROM profiles;
-- Expected: missed = 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00025_push_prompted_at.sql
git commit -m "$(cat <<'EOF'
feat(db): push_prompted_at column + backfill

Gates the one-time push permission sheet on cooking view for
shared-link new users. Backfills now() for users already past v9
onboarding so they don't see it again.
EOF
)"
```

---

## Chunk 2: Backend infrastructure — JWT helpers, storage copy, email

This chunk lands the three reusable utilities the clone-and-expand and claim-session endpoints depend on. No new HTTP routes yet — just well-tested library code.

### Task 5: Add dependencies (jose, resend)

**Files:**
- Modify: `pipeline/package.json`

- [ ] **Step 1: Install deps**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm install jose resend
```

Expected: `jose` and `resend` appear in `dependencies` in `package.json`. Both are pure-JS, no native deps.

- [ ] **Step 2: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/package.json pipeline/package-lock.json && git commit -m "$(cat <<'EOF'
deps(pipeline): jose for JWT signing, resend for transactional email
EOF
)"
```

### Task 6: claimToken helper — sign and verify

**Files:**
- Create: `pipeline/src/lib/claimToken.ts`
- Test: `pipeline/tests/claimToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/tests/claimToken.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { signClaimToken, verifyClaimToken } from "../src/lib/claimToken.js";

const SECRET = "test-secret-must-be-at-least-32-bytes-long-for-HS256-yo";

describe("claimToken", () => {
  beforeEach(() => {
    process.env.SESSION_CLAIM_JWT_SECRET = SECRET;
  });

  it("signs and verifies a round trip", async () => {
    const userId = "00000000-0000-0000-0000-000000000001";
    const { token, jti, expiresAt } = await signClaimToken(userId);
    expect(token.split(".")).toHaveLength(3);
    expect(jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verified = await verifyClaimToken(token);
    expect(verified.sub).toBe(userId);
    expect(verified.jti).toBe(jti);
    expect(verified.scope).toBe("share_claim");
  });

  it("rejects an expired token", async () => {
    process.env.SESSION_CLAIM_JWT_SECRET = SECRET;
    // Sign with a backdated exp by mocking — easier: sign normally, then
    // verify with a clock skew that pushes us past exp.
    const { token } = await signClaimToken(
      "00000000-0000-0000-0000-000000000002",
      { ttlSeconds: 1 },
    );
    await new Promise((r) => setTimeout(r, 1500));
    await expect(verifyClaimToken(token)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const { token } = await signClaimToken("00000000-0000-0000-0000-000000000003");
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(verifyClaimToken(tampered)).rejects.toThrow();
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.SESSION_CLAIM_JWT_SECRET = SECRET;
    const { token } = await signClaimToken("00000000-0000-0000-0000-000000000004");
    process.env.SESSION_CLAIM_JWT_SECRET = "different-secret-but-also-32-bytes-long-yo!!";
    await expect(verifyClaimToken(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimToken.test.ts
```

Expected: file-not-found error on the import.

- [ ] **Step 3: Implement the helper**

```ts
// pipeline/src/lib/claimToken.ts
/**
 * JWT helpers for the session-claim token. Signed with HS256 using
 * SESSION_CLAIM_JWT_SECRET. 90-day default TTL; the caller can pass
 * a shorter TTL for tests. The scope claim is hardcoded so any later
 * "we'll add more JWT types" expansion stays compatible.
 */
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";

const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export type ClaimTokenPayload = {
  sub: string; // target user_id
  jti: string;
  scope: "share_claim";
  iat: number;
  exp: number;
};

export type SignResult = {
  token: string;
  jti: string;
  expiresAt: Date;
};

function getSecretBytes(): Uint8Array {
  const raw = process.env.SESSION_CLAIM_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("SESSION_CLAIM_JWT_SECRET is missing or too short (need ≥32 chars)");
  }
  return new TextEncoder().encode(raw);
}

export async function signClaimToken(
  userId: string,
  opts: { ttlSeconds?: number } = {},
): Promise<SignResult> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jti = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + ttl;

  const token = await new SignJWT({ scope: "share_claim" as const })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(getSecretBytes());

  return { token, jti, expiresAt: new Date(expSec * 1000) };
}

export async function verifyClaimToken(token: string): Promise<ClaimTokenPayload> {
  const { payload } = await jwtVerify(token, getSecretBytes(), {
    algorithms: ["HS256"],
  });
  if (payload.scope !== "share_claim") {
    throw new Error("invalid scope");
  }
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw new Error("missing sub or jti");
  }
  return payload as ClaimTokenPayload;
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimToken.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/lib/claimToken.ts pipeline/tests/claimToken.test.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): claimToken sign/verify helpers

HS256 JWT signed with SESSION_CLAIM_JWT_SECRET. Hardcoded
share_claim scope so future JWT types stay disjoint. 90-day
default TTL; tests cover round-trip, expiry, tampering, and
secret mismatch.
EOF
)"
```

### Task 7: storageCopy helper — idempotent multi-blob copy

**Files:**
- Create: `pipeline/src/lib/storageCopy.ts`
- Test: `pipeline/tests/storageCopy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/tests/storageCopy.test.ts
import { describe, expect, it, vi } from "vitest";
import { copyPodcastBlobs, type CopyClient } from "../src/lib/storageCopy.js";

function mockClient(initial: Record<string, Set<string>> = {}): CopyClient & {
  buckets: Record<string, Set<string>>;
  copyCalls: { bucket: string; from: string; to: string }[];
} {
  const buckets: Record<string, Set<string>> = {
    "podcast-audio": new Set(initial["podcast-audio"] ?? []),
    "podcast-covers": new Set(initial["podcast-covers"] ?? []),
    "podcast-transcripts": new Set(initial["podcast-transcripts"] ?? []),
  };
  const copyCalls: { bucket: string; from: string; to: string }[] = [];
  return {
    buckets,
    copyCalls,
    list: async (bucket, path) => buckets[bucket]?.has(path) ?? false,
    copy: async (bucket, from, to) => {
      copyCalls.push({ bucket, from, to });
      if (!buckets[bucket].has(from)) throw new Error(`source missing: ${bucket}/${from}`);
      if (buckets[bucket].has(to)) throw new Error(`dest exists: ${bucket}/${to}`);
      buckets[bucket].add(to);
    },
  };
}

describe("copyPodcastBlobs", () => {
  it("copies audio, cover, transcript to deterministic destination paths", async () => {
    const client = mockClient({
      "podcast-audio": new Set(["user-a/source.mp3"]),
      "podcast-covers": new Set(["user-a/source.png"]),
      "podcast-transcripts": new Set(["user-a/source.txt"]),
    });
    const result = await copyPodcastBlobs(client, {
      sourceUserId: "user-a",
      sourcePodcastId: "source",
      targetUserId: "user-b",
      targetPodcastId: "target",
      hasCover: true,
      hasTranscript: true,
    });
    expect(result.audioPath).toBe("user-b/target.mp3");
    expect(result.coverPath).toBe("user-b/target.png");
    expect(result.transcriptPath).toBe("user-b/target.txt");
    expect(client.copyCalls).toHaveLength(3);
  });

  it("skips copies when destination already exists", async () => {
    const client = mockClient({
      "podcast-audio": new Set(["user-a/source.mp3", "user-b/target.mp3"]),
      "podcast-covers": new Set(["user-a/source.png"]),
      "podcast-transcripts": new Set(["user-a/source.txt"]),
    });
    await copyPodcastBlobs(client, {
      sourceUserId: "user-a",
      sourcePodcastId: "source",
      targetUserId: "user-b",
      targetPodcastId: "target",
      hasCover: true,
      hasTranscript: true,
    });
    // Audio was already at destination — only cover + transcript copied
    expect(client.copyCalls).toHaveLength(2);
    expect(client.copyCalls.map((c) => c.bucket)).toEqual(["podcast-covers", "podcast-transcripts"]);
  });

  it("omits cover when hasCover=false", async () => {
    const client = mockClient({
      "podcast-audio": new Set(["user-a/source.mp3"]),
      "podcast-transcripts": new Set(["user-a/source.txt"]),
    });
    const result = await copyPodcastBlobs(client, {
      sourceUserId: "user-a",
      sourcePodcastId: "source",
      targetUserId: "user-b",
      targetPodcastId: "target",
      hasCover: false,
      hasTranscript: true,
    });
    expect(result.coverPath).toBeNull();
    expect(client.copyCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/storageCopy.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement the helper**

```ts
// pipeline/src/lib/storageCopy.ts
/**
 * Idempotent multi-blob copy for cloned podcasts. For audio/cover/
 * transcript, the destination path is deterministic
 * (<target_user_id>/<target_podcast_id>.<ext>). We HEAD the destination
 * first; if it exists, we skip the copy (Supabase Storage copy errors
 * on existing destination, so the existence check is required, not
 * optional). Source either copies fully or not at all — Supabase's
 * copy is server-side atomic.
 */

export type CopyClient = {
  list: (bucket: string, path: string) => Promise<boolean>;
  copy: (bucket: string, from: string, to: string) => Promise<void>;
};

export type CopyInput = {
  sourceUserId: string;
  sourcePodcastId: string;
  targetUserId: string;
  targetPodcastId: string;
  hasCover: boolean;
  hasTranscript: boolean;
};

export type CopyResult = {
  audioPath: string;
  coverPath: string | null;
  transcriptPath: string | null;
};

const BUCKETS = {
  audio: "podcast-audio",
  cover: "podcast-covers",
  transcript: "podcast-transcripts",
} as const;

async function copyIfMissing(
  client: CopyClient,
  bucket: string,
  from: string,
  to: string,
): Promise<void> {
  const exists = await client.list(bucket, to);
  if (exists) return;
  await client.copy(bucket, from, to);
}

export async function copyPodcastBlobs(
  client: CopyClient,
  input: CopyInput,
): Promise<CopyResult> {
  const audioFrom = `${input.sourceUserId}/${input.sourcePodcastId}.mp3`;
  const audioTo = `${input.targetUserId}/${input.targetPodcastId}.mp3`;
  await copyIfMissing(client, BUCKETS.audio, audioFrom, audioTo);

  let coverPath: string | null = null;
  if (input.hasCover) {
    const coverFrom = `${input.sourceUserId}/${input.sourcePodcastId}.png`;
    coverPath = `${input.targetUserId}/${input.targetPodcastId}.png`;
    await copyIfMissing(client, BUCKETS.cover, coverFrom, coverPath);
  }

  let transcriptPath: string | null = null;
  if (input.hasTranscript) {
    const txtFrom = `${input.sourceUserId}/${input.sourcePodcastId}.txt`;
    transcriptPath = `${input.targetUserId}/${input.targetPodcastId}.txt`;
    await copyIfMissing(client, BUCKETS.transcript, txtFrom, transcriptPath);
  }

  return { audioPath: audioTo, coverPath, transcriptPath };
}

/**
 * Builds a CopyClient backed by a Supabase service-role client. Used in
 * production; tests use the in-memory mockClient instead.
 */
export function makeSupabaseCopyClient(supabase: any): CopyClient {
  return {
    list: async (bucket, path) => {
      // list({ search }) returns at most one entry matching the basename;
      // we treat any match as "exists". Cheaper than HEAD via Storage's
      // download URL.
      const parts = path.split("/");
      const dir = parts.slice(0, -1).join("/");
      const name = parts[parts.length - 1];
      const { data, error } = await supabase.storage.from(bucket).list(dir, {
        search: name,
        limit: 1,
      });
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
    copy: async (bucket, from, to) => {
      const { error } = await supabase.storage.from(bucket).copy(from, to);
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 4: Run and confirm pass**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/storageCopy.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/lib/storageCopy.ts pipeline/tests/storageCopy.test.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): idempotent storage copy helper

Existence-check before copy — Supabase Storage copy errors on
existing destination, so we skip when the deterministic dest path
already has an object. Source either copies fully or not at all
(server-side atomic). Test against an in-memory mock; production
uses the Supabase service-role storage client adapter.
EOF
)"
```

### Task 8: claimEmail helper — Resend-backed transactional send

**Files:**
- Create: `pipeline/src/lib/claimEmail.ts`

- [ ] **Step 1: Implement the helper**

This one is best-effort and minimal — no unit test required at this layer (we mock at the endpoint test layer instead). The function returns a result object indicating success or failure; the caller logs and moves on.

```ts
// pipeline/src/lib/claimEmail.ts
/**
 * Sends the "Open in app" transactional email containing the Universal
 * Link with the claim token. Best-effort: failures are returned, not
 * thrown — the calling endpoint logs and proceeds (the in-page CTA
 * still works without email).
 *
 * Requires RESEND_API_KEY and EMAIL_FROM env vars. EMAIL_FROM must be a
 * verified sender domain in Resend (e.g. "noreply@katavoapp.com" once
 * DKIM/SPF/DMARC is set up for katavoapp.com).
 *
 * The template is plain text + a single CTA button. Subject line drives
 * the impression more than the body.
 */
import { Resend } from "resend";

export type ClaimEmailInput = {
  to: string;
  universalLink: string;
};

export type ClaimEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function sendClaimEmail(input: ClaimEmailInput): Promise<ClaimEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, reason: "email_not_configured" };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: "Your Katavo podcast is ready",
      html: `
<p>Your podcast is cooking — open Katavo to listen the moment it's done.</p>
<p><a href="${input.universalLink}" style="display:inline-block;padding:12px 20px;background:#2D5040;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open Katavo</a></p>
<p style="color:#84858C;font-size:13px">If the button doesn't open the app, paste this link into your browser: <br><a href="${input.universalLink}">${input.universalLink}</a></p>
      `.trim(),
    });
    if (error) return { ok: false, reason: error.message ?? "resend_error" };
    return { ok: true, id: data!.id };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/lib/claimEmail.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): claimEmail helper backed by Resend

Best-effort transactional send for the Open-in-app Universal Link.
Returns ok/false rather than throwing — the calling endpoint logs
and proceeds. Disabled cleanly when RESEND_API_KEY or EMAIL_FROM
are unset, so we can ship without email in v1 if Resend setup
slips and add it later by setting env vars.
EOF
)"
```

---

## Chunk 3: Backend — `/api/share/clone-and-expand` endpoint

This is the heart of the feature. After this chunk: an authed POST clones a shared tree into the caller's account, copies storage, deducts a credit, queues the expansion, and (for fresh signups) sets onboarding/voice + issues a claim token. State A on the share page (which we'll wire in Chunk 5) calls this.

### Task 9: Endpoint scaffold + happy-path test

**Files:**
- Create: `pipeline/src/routes/cloneAndExpand.ts`
- Create: `pipeline/tests/cloneAndExpand.test.ts`

- [ ] **Step 1: Write the happy-path failing test**

```ts
// pipeline/tests/cloneAndExpand.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mocks for Supabase service-role client used by the route. Each test
// constructs a fresh mock. We don't go through Hono's testing client
// in this first iteration — instead we call the route handler with
// a hand-constructed Context. Subsequent tests cover error branches.

import { Hono } from "hono";
import { cloneAndExpandRoute } from "../src/routes/cloneAndExpand.js";

const SHARE_TOKEN = "tok-abcdef1234";
const TARGET_USER = "00000000-0000-0000-0000-0000000000aa";
const SOURCE_USER = "00000000-0000-0000-0000-0000000000bb";
const CLONED_PARENT = "00000000-0000-0000-0000-0000000000cc";
const EXPANSION_ID = "00000000-0000-0000-0000-0000000000dd";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("../src/middleware/auth.js", () => ({
  userAuth: async (c: any, next: any) => {
    c.set("user", { id: TARGET_USER, email: "test@example.com", created_at: new Date().toISOString() });
    await next();
  },
}));

vi.mock("../src/lib/storageCopy.js", () => ({
  copyPodcastBlobs: vi.fn().mockResolvedValue({
    audioPath: `${TARGET_USER}/${CLONED_PARENT}.mp3`,
    coverPath: `${TARGET_USER}/${CLONED_PARENT}.png`,
    transcriptPath: `${TARGET_USER}/${CLONED_PARENT}.txt`,
  }),
  makeSupabaseCopyClient: vi.fn().mockReturnValue({ list: vi.fn(), copy: vi.fn() }),
}));

describe("POST /api/share/clone-and-expand happy path", () => {
  beforeEach(() => {
    process.env.SESSION_CLAIM_JWT_SECRET = "test-secret-must-be-at-least-32-bytes-long-for-HS256-yo";
    process.env.SHARE_PUBLIC_BASE_URL = "https://katavoapp.com";
  });

  it("clones, deducts credit, queues expansion, issues claim token for fresh signup", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue(makeSupabaseMockSuccess());

    const app = new Hono();
    app.route("/api/share/clone-and-expand", cloneAndExpandRoute);

    const res = await app.request("/api/share/clone-and-expand", {
      method: "POST",
      headers: { Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ share_token: SHARE_TOKEN, chapter_index: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cloned_parent_id).toBe(CLONED_PARENT);
    expect(body.expansion_podcast_id).toBe(EXPANSION_ID);
    expect(typeof body.claim_token).toBe("string");
    expect(body.claim_token.split(".")).toHaveLength(3);
  });
});

function makeSupabaseMockSuccess(): any {
  const rpcFn = vi.fn().mockResolvedValue({
    data: [
      {
        cloned_parent_id: CLONED_PARENT,
        cloned_descendant_ids: [],
        descendant_source_chapters: [],
      },
    ],
    error: null,
  });
  return {
    rpc: rpcFn,
    from: vi.fn((table: string) => makeTable(table)),
    storage: { from: vi.fn(() => ({})) },
  };
}

function makeTable(table: string): any {
  if (table === "podcasts") {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: CLONED_PARENT,
          user_id: SOURCE_USER,
          voice: "Sulafat",
          cover_url: "covers/x.png",
          transcript_url: "txt/x.txt",
          chapter_markers: [
            { timestampSeconds: 0, title: "Intro" },
            { timestampSeconds: 60, title: "Topic two" },
          ],
        },
        error: null,
      }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EXPANSION_ID },
        error: null,
      }),
      update: vi.fn().mockReturnThis(),
    };
  }
  if (table === "subscriptions") {
    return {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { credits: 4 },
        error: null,
      }),
    };
  }
  if (table === "session_claim_tokens") {
    return { insert: vi.fn().mockResolvedValue({ error: null }) };
  }
  if (table === "profiles") {
    return {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
  }
  return {};
}
```

- [ ] **Step 2: Run and confirm fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/cloneAndExpand.test.ts
```

Expected: route import fails.

- [ ] **Step 3: Implement the route**

```ts
// pipeline/src/routes/cloneAndExpand.ts
/**
 * POST /api/share/clone-and-expand
 *
 * Authed via Supabase JWT. Clones the shared tree (parent + all
 * descendants) into the caller's account, copies Storage blobs,
 * transactionally deducts one credit and inserts the expansion row,
 * enqueues the pipeline job, and — for fresh signups — issues a
 * session-claim token + sets profile.onboarding_completed_at +
 * profile.voice.
 *
 * The "fresh signup" gate: auth.users.created_at >= request_started_at - 5m.
 * Measured against request entry, not request end, so a slow request
 * doesn't disqualify a genuinely-fresh user.
 *
 * Errors: 401 (no JWT), 400 (bad body), 410 (share token revoked),
 *         402 (out of credits), 500 (RPC/storage/email failure).
 */
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { userAuth } from "../middleware/auth.js";
import { signClaimToken } from "../lib/claimToken.js";
import { copyPodcastBlobs, makeSupabaseCopyClient } from "../lib/storageCopy.js";
import { sendClaimEmail } from "../lib/claimEmail.js";
import { enqueuePipelineJob } from "../routes/submitPodcast.js"; // we'll export this in Task 13

const FRESH_SIGNUP_WINDOW_MS = 5 * 60 * 1000;

const route = new Hono();

route.post("/", userAuth, async (c) => {
  const requestStartedAt = Date.now();
  const user = c.get("user");

  // Body parsing + basic validation
  let body: { share_token?: unknown; chapter_index?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const shareToken = typeof body.share_token === "string" ? body.share_token : null;
  const chapterIndex = typeof body.chapter_index === "number" ? body.chapter_index : null;
  if (!shareToken || chapterIndex === null || chapterIndex < 0) {
    return c.json({ error: "bad input" }, 400);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Call clone_shared_tree RPC
  const { data: cloneRows, error: cloneErr } = await supabase.rpc("clone_shared_tree", {
    p_share_token: shareToken,
    p_target_user_id: user.id,
  });
  if (cloneErr) {
    if (cloneErr.message?.includes("share_revoked")) {
      return c.json({ error: "share_revoked" }, 410);
    }
    console.error("clone_shared_tree failed:", cloneErr);
    return c.json({ error: "clone_failed" }, 500);
  }
  const cloneRow = Array.isArray(cloneRows) ? cloneRows[0] : null;
  if (!cloneRow?.cloned_parent_id) {
    return c.json({ error: "share_revoked" }, 410);
  }
  const clonedParentId: string = cloneRow.cloned_parent_id;
  const descendantChapters: string[] = cloneRow.descendant_source_chapters ?? [];

  // 2. Load cloned parent to resolve chapter title, voice, and source paths
  const { data: parent, error: parentErr } = await supabase
    .from("podcasts")
    .select("id, user_id, voice, cover_url, transcript_url, chapter_markers")
    .eq("id", clonedParentId)
    .maybeSingle();
  if (parentErr || !parent) {
    console.error("loading cloned parent failed:", parentErr);
    return c.json({ error: "internal" }, 500);
  }

  const markers: { timestampSeconds: number; title: string }[] =
    Array.isArray(parent.chapter_markers) ? parent.chapter_markers : [];
  if (chapterIndex >= markers.length) {
    return c.json({ error: "chapter_out_of_range" }, 400);
  }
  const sourceChapterTitle = markers[chapterIndex].title;

  // 3. Storage copy step — for the parent and each cloned descendant.
  //    We discover the (sourceUserId, sourcePodcastId) pairs by reading
  //    the source share tree once more — alternative is to extend the
  //    RPC to return source ids, but doing it here keeps the RPC tight.
  const { data: tree, error: treeErr } = await supabase.rpc("get_shared_tree", {
    p_token: shareToken,
  });
  if (treeErr) {
    console.error("get_shared_tree failed:", treeErr);
    return c.json({ error: "internal" }, 500);
  }
  const copyClient = makeSupabaseCopyClient(supabase);
  // Pair each source row with its cloned counterpart by walking in the
  // same topological order. We use cloned_descendant_ids + the parent
  // to build the cloned-id-by-source-chapter-title map.
  const allClonedIds = [clonedParentId, ...(cloneRow.cloned_descendant_ids ?? [])];
  // Cloned rows have audio_url/cover_url/transcript_url initially pointing
  // at the source paths; we rewrite them after copy. For storage copy,
  // we need original (sourceUserId, sourcePodcastId). The tree rows give
  // us source ids; we map old_id → cloned_id by topological order.
  // Simpler approach: trust that source-tree ordering and cloned-id
  // ordering align (the RPC inserts in topological order).
  const sourceRowsOrdered = tree
    .filter((r: any) => r.is_root)
    .concat(tree.filter((r: any) => !r.is_root));
  if (sourceRowsOrdered.length !== allClonedIds.length) {
    console.error("clone/source length mismatch — storage copy aborted");
    return c.json({ error: "internal" }, 500);
  }
  for (let i = 0; i < sourceRowsOrdered.length; i++) {
    const src = sourceRowsOrdered[i];
    const cloneId = allClonedIds[i];
    try {
      const result = await copyPodcastBlobs(copyClient, {
        sourceUserId: src.user_id,
        sourcePodcastId: src.id,
        targetUserId: user.id,
        targetPodcastId: cloneId,
        hasCover: src.has_cover === true,
        hasTranscript: true, // every complete podcast has a transcript
      });
      // Update cloned row's URL columns to point at new paths.
      await supabase
        .from("podcasts")
        .update({
          audio_url: result.audioPath,
          cover_url: result.coverPath,
          transcript_url: result.transcriptPath,
        })
        .eq("id", cloneId);
    } catch (err) {
      console.error(`storage copy failed for ${cloneId}:`, err);
      // Don't bail — partial state is recoverable on retry. Continue
      // so the user still gets something.
    }
  }

  // 4. Chapter dedup — does the cloned tree already have an expansion
  //    for this chapter title?
  const existingIdx = descendantChapters.indexOf(sourceChapterTitle);
  if (existingIdx >= 0) {
    const existingId = cloneRow.cloned_descendant_ids[existingIdx];
    return c.json({
      cloned_parent_id: clonedParentId,
      expansion_podcast_id: existingId,
    });
  }

  // 5. Transactional credit deduction + expansion row insert.
  //    We use a single RPC for atomicity (see Task 11 — deduct_credit_and_insert_expansion).
  const { data: insertRow, error: insertErr } = await supabase.rpc(
    "deduct_credit_and_insert_expansion",
    {
      p_user_id: user.id,
      p_parent_podcast_id: clonedParentId,
      p_source_chapter_title: sourceChapterTitle,
      p_voice: parent.voice,
    },
  );
  if (insertErr) {
    if (insertErr.message?.includes("insufficient_credits")) {
      return c.json({ error: "insufficient_credits" }, 402);
    }
    if (insertErr.message?.includes("chapter_taken")) {
      // Race-loser: someone else won the unique index. Re-read to find
      // the winning row.
      const { data: winner } = await supabase
        .from("podcasts")
        .select("id")
        .eq("parent_podcast_id", clonedParentId)
        .eq("source_chapter_title", sourceChapterTitle)
        .is("deleted_at", null)
        .maybeSingle();
      if (winner) {
        return c.json({
          cloned_parent_id: clonedParentId,
          expansion_podcast_id: winner.id,
        });
      }
      return c.json({ error: "internal" }, 500);
    }
    console.error("deduct_and_insert failed:", insertErr);
    return c.json({ error: "internal" }, 500);
  }
  const expansionRow = Array.isArray(insertRow) ? insertRow[0] : insertRow;
  const expansionId: string = expansionRow.expansion_id;

  // 6. Enqueue the pipeline job.
  try {
    await enqueuePipelineJob(expansionId);
  } catch (err) {
    console.error("enqueue failed; marking expansion as failed:", err);
    await supabase.from("podcasts").update({ status: "failed" }).eq("id", expansionId);
    return c.json({ error: "enqueue_failed" }, 500);
  }

  // 7. Fresh-signup gate: profile mutations + claim token issuance.
  let claimToken: string | undefined;
  const userCreatedAt = new Date(user.created_at).getTime();
  if (userCreatedAt >= requestStartedAt - FRESH_SIGNUP_WINDOW_MS) {
    await supabase
      .from("profiles")
      .update({
        onboarding_completed_at: new Date().toISOString(),
        voice: parent.voice,
      })
      .eq("id", user.id);

    const { token, jti, expiresAt } = await signClaimToken(user.id);
    const { error: tokInsertErr } = await supabase.from("session_claim_tokens").insert({
      jti,
      user_id: user.id,
      expires_at: expiresAt.toISOString(),
    });
    if (tokInsertErr) {
      console.error("claim token insert failed (continuing):", tokInsertErr);
    } else {
      claimToken = token;
      // Fire-and-forget email — best-effort.
      const base = process.env.SHARE_PUBLIC_BASE_URL ?? "https://katavoapp.com";
      const universalLink = `${base}/expand/${shareToken}/${chapterIndex}?claim=${token}&p=${clonedParentId}`;
      sendClaimEmail({ to: user.email!, universalLink }).then((r) => {
        if (!r.ok) console.warn("claim email failed:", r.reason);
      });
    }
  }

  return c.json({
    cloned_parent_id: clonedParentId,
    expansion_podcast_id: expansionId,
    claim_token: claimToken,
  });
});

export { route as cloneAndExpandRoute };
```

- [ ] **Step 4: The test will still fail — we need the `deduct_credit_and_insert_expansion` RPC and the `enqueuePipelineJob` export. Implement those in Task 10 and Task 13 respectively before re-running the test.**

- [ ] **Step 5: Stage the file but DO NOT commit yet — we need Task 10 first**

### Task 10: deduct_credit_and_insert_expansion SQL function

**Files:**
- Modify: `supabase/migrations/00023_clone_shared_tree.sql` — NO. Add a new migration so 00023 stays atomic.
- Create: `supabase/migrations/00026_deduct_and_insert.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00026_deduct_and_insert.sql
-- Atomic credit-deduction + expansion-row insert for the
-- /api/share/clone-and-expand endpoint. The two ops must be in the
-- same transaction so we never debit a credit without an expansion
-- row to refund against, and never insert a row without a paying
-- credit. Wraps both in a plpgsql block with explicit exception
-- handling for the two predictable failure modes.

CREATE OR REPLACE FUNCTION public.deduct_credit_and_insert_expansion(
  p_user_id uuid,
  p_parent_podcast_id uuid,
  p_source_chapter_title text,
  p_voice text
)
RETURNS TABLE (expansion_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expansion_id uuid := gen_random_uuid();
  v_credits_remaining int;
BEGIN
  -- Row-locked predicate decrement. Two concurrent calls serialize on
  -- the subscription row; the second sees the post-decrement value.
  UPDATE subscriptions
     SET credits = credits - 1
   WHERE user_id = p_user_id
     AND credits > 0
   RETURNING credits INTO v_credits_remaining;

  IF v_credits_remaining IS NULL THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0002';
  END IF;

  -- Insert the expansion row. The same-chapter unique partial index
  -- (from migration 00023) makes this throw on conflict if a racing
  -- request beat us to it.
  BEGIN
    INSERT INTO podcasts (
      id, user_id, parent_podcast_id, source_chapter_title,
      voice, status, topic
    ) VALUES (
      v_expansion_id, p_user_id, p_parent_podcast_id, p_source_chapter_title,
      p_voice, 'queued',
      -- topic gets filled in by the pipeline; placeholder for NOT NULL
      'Expansion: ' || p_source_chapter_title
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'chapter_taken' USING ERRCODE = 'P0003';
  END;

  expansion_id := v_expansion_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_credit_and_insert_expansion(uuid, uuid, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credit_and_insert_expansion(uuid, uuid, text, text)
  TO service_role;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `00026_deduct_and_insert`.

- [ ] **Step 3: Verify the function exists**

```sql
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'deduct_credit_and_insert_expansion';
-- Expected: 1 row, prosecdef = true
```

- [ ] **Step 4: Smoke test happy path**

```sql
-- Set up a test parent for a real user with a credit
SELECT user_id, credits FROM subscriptions WHERE credits > 0 LIMIT 1;
-- Pick an existing parent_podcast_id owned by that user
SELECT id FROM podcasts WHERE user_id = '<user_id>'::uuid AND parent_podcast_id IS NULL LIMIT 1;

SELECT * FROM public.deduct_credit_and_insert_expansion(
  '<user_id>'::uuid,
  '<parent_id>'::uuid,
  'Smoke test chapter',
  'Sulafat'
);
-- Expected: returns a new uuid

-- Verify credit was deducted
SELECT credits FROM subscriptions WHERE user_id = '<user_id>'::uuid;
-- Expected: prior_value - 1

-- Verify expansion row inserted with status='queued'
SELECT id, status, source_chapter_title FROM podcasts
WHERE source_chapter_title = 'Smoke test chapter' AND user_id = '<user_id>'::uuid;
```

Clean up:

```sql
DELETE FROM podcasts WHERE source_chapter_title = 'Smoke test chapter' AND user_id = '<user_id>'::uuid;
UPDATE subscriptions SET credits = credits + 1 WHERE user_id = '<user_id>'::uuid;
```

- [ ] **Step 5: Commit migration + cloneAndExpand route + test together**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add supabase/migrations/00026_deduct_and_insert.sql pipeline/src/routes/cloneAndExpand.ts pipeline/tests/cloneAndExpand.test.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): clone-and-expand endpoint + atomic credit-and-insert RPC

POST /api/share/clone-and-expand is the main entry point for the
shared-podcast-expansion flow. It calls clone_shared_tree, copies
Storage blobs, looks up the chapter title, calls the new
deduct_credit_and_insert_expansion SQL function (atomic credit
deduction + expansion row insert with unique-violation handling for
the same-chapter race), enqueues the pipeline job, and — for users
whose auth.users.created_at is within 5 minutes of request entry —
sets onboarding_completed_at + voice and issues a 90-day session
claim token delivered via response body + best-effort email.
EOF
)"
```

### Task 11: Error-branch tests for clone-and-expand

**Files:**
- Modify: `pipeline/tests/cloneAndExpand.test.ts`

- [ ] **Step 1: Add four more tests**

```ts
describe("POST /api/share/clone-and-expand error branches", () => {
  beforeEach(() => {
    process.env.SESSION_CLAIM_JWT_SECRET = "test-secret-must-be-at-least-32-bytes-long-for-HS256-yo";
    process.env.SHARE_PUBLIC_BASE_URL = "https://katavoapp.com";
  });

  it("returns 400 on missing share_token", async () => {
    const app = new Hono();
    app.route("/api/share/clone-and-expand", cloneAndExpandRoute);
    const res = await app.request("/api/share/clone-and-expand", {
      method: "POST",
      headers: { Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_index: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 410 when share token is revoked (RPC raises share_revoked)", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "share_revoked" },
      }),
      from: vi.fn(),
      storage: { from: vi.fn() },
    });
    const app = new Hono();
    app.route("/api/share/clone-and-expand", cloneAndExpandRoute);
    const res = await app.request("/api/share/clone-and-expand", {
      method: "POST",
      headers: { Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ share_token: SHARE_TOKEN, chapter_index: 0 }),
    });
    expect(res.status).toBe(410);
  });

  it("returns 402 on insufficient credits", async () => {
    // ... (mock setup that returns 'insufficient_credits' error from
    //      deduct_credit_and_insert_expansion RPC)
    // Detailed mock omitted for brevity — follow the pattern of the
    // happy-path mock but make the second rpc call fail.
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue(makeMockInsufficientCredits());
    const app = new Hono();
    app.route("/api/share/clone-and-expand", cloneAndExpandRoute);
    const res = await app.request("/api/share/clone-and-expand", {
      method: "POST",
      headers: { Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ share_token: SHARE_TOKEN, chapter_index: 0 }),
    });
    expect(res.status).toBe(402);
  });

  it("returns existing expansion id (no credit charge) when chapter already cloned", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue(makeMockChapterAlreadyCloned());
    const app = new Hono();
    app.route("/api/share/clone-and-expand", cloneAndExpandRoute);
    const res = await app.request("/api/share/clone-and-expand", {
      method: "POST",
      headers: { Authorization: "Bearer fake-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ share_token: SHARE_TOKEN, chapter_index: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expansion_podcast_id).toBe("00000000-0000-0000-0000-0000000000ee");
    expect(body.claim_token).toBeUndefined();
  });
});

function makeMockInsufficientCredits(): any {
  // RPC for clone returns parent ok; second RPC returns insufficient_credits
  let rpcCalls = 0;
  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      rpcCalls++;
      if (name === "clone_shared_tree") {
        return Promise.resolve({
          data: [{ cloned_parent_id: CLONED_PARENT, cloned_descendant_ids: [], descendant_source_chapters: [] }],
          error: null,
        });
      }
      if (name === "get_shared_tree") {
        return Promise.resolve({ data: [{ id: "src-root", user_id: SOURCE_USER, is_root: true, has_cover: false }], error: null });
      }
      if (name === "deduct_credit_and_insert_expansion") {
        return Promise.resolve({ data: null, error: { message: "insufficient_credits" } });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table) => makeTable(table)),
    storage: { from: vi.fn(() => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }), copy: vi.fn().mockResolvedValue({ error: null }) })) },
  };
}

function makeMockChapterAlreadyCloned(): any {
  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === "clone_shared_tree") {
        return Promise.resolve({
          data: [{
            cloned_parent_id: CLONED_PARENT,
            cloned_descendant_ids: ["00000000-0000-0000-0000-0000000000ee"],
            descendant_source_chapters: ["Topic two"],
          }],
          error: null,
        });
      }
      if (name === "get_shared_tree") {
        return Promise.resolve({ data: [
          { id: "src-root", user_id: SOURCE_USER, is_root: true, has_cover: false },
          { id: "src-child", user_id: SOURCE_USER, is_root: false, has_cover: false, parent_podcast_id: "src-root" },
        ], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table) => makeTable(table)),
    storage: { from: vi.fn(() => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }), copy: vi.fn().mockResolvedValue({ error: null }) })) },
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/cloneAndExpand.test.ts
```

Expected: 5 tests pass (happy path + 4 error branches).

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/tests/cloneAndExpand.test.ts && git commit -m "$(cat <<'EOF'
test(pipeline): error branches for clone-and-expand endpoint

400 on missing share_token, 410 on revoked share, 402 on
insufficient credits, 200 + existing id when chapter already cloned.
EOF
)"
```

### Task 12: Mount the route in server.ts

**Files:**
- Modify: `pipeline/src/server.ts`

- [ ] **Step 1: Add the import and route**

```ts
// Below the other route imports
import { cloneAndExpandRoute } from "./routes/cloneAndExpand.js";

// Below the other app.route() lines
app.route("/api/share/clone-and-expand", cloneAndExpandRoute);
```

- [ ] **Step 2: Run typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/server.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): mount /api/share/clone-and-expand in server
EOF
)"
```

### Task 13: Export `enqueuePipelineJob` from submitPodcast for reuse

**Files:**
- Modify: `pipeline/src/routes/submitPodcast.ts`

- [ ] **Step 1: Find the existing job-manager push logic**

```bash
grep -n "jobManager" "/Users/isuru/personal/AI Podcast App/pipeline/src/routes/submitPodcast.ts"
```

- [ ] **Step 2: Export a thin function**

Locate the section in `submitPodcast.ts` that pushes a job onto `jobManager` for a given podcast id. Extract it into an exported function `enqueuePipelineJob(podcastId: string): Promise<void>` that the cloneAndExpand route already imports. The function reads from the module-level `jobManager` that `setJobManager` already populates.

Skeleton:
```ts
export async function enqueuePipelineJob(podcastId: string): Promise<void> {
  if (!jobManager) throw new Error("job manager not initialized");
  await jobManager.enqueue(podcastId);
}
```

- [ ] **Step 3: Update submitPodcast itself to call this shared function**

DRY — replace any inline `jobManager.enqueue` calls in submitPodcast with `await enqueuePipelineJob(...)`.

- [ ] **Step 4: Run all pipeline tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run
```

Expected: all existing tests still pass; new cloneAndExpand tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/submitPodcast.ts && git commit -m "$(cat <<'EOF'
refactor(pipeline): extract enqueuePipelineJob for reuse

clone-and-expand needs to push jobs the same way submit-podcast
does. Extract the call into a shared exported function and call it
from both routes — keeps the queue ordering and retry config in one
place.
EOF
)"
```

---

## Chunk 4: Backend — claim-session, well-known, cleanup cron

After this chunk: the mobile app can exchange a claim token for a Supabase session; iOS and Android verify Universal Link ownership via static well-known files; expired claim tokens get cleaned up hourly.

### Task 14: claim-session endpoint

**Files:**
- Create: `pipeline/src/routes/claimSession.ts`
- Create: `pipeline/tests/claimSession.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/tests/claimSession.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { claimSessionRoute } from "../src/routes/claimSession.js";
import { signClaimToken } from "../src/lib/claimToken.js";

const SECRET = "test-secret-must-be-at-least-32-bytes-long-for-HS256-yo";
const USER_ID = "00000000-0000-0000-0000-0000000000ff";
const USER_EMAIL = "claim@example.com";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

describe("POST /api/auth/claim-session", () => {
  beforeEach(() => {
    process.env.SESSION_CLAIM_JWT_SECRET = SECRET;
  });

  it("redeems a fresh token and returns token_hash + email", async () => {
    const { token, jti } = await signClaimToken(USER_ID);
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue({
      from: vi.fn().mockImplementation((t: string) => {
        if (t === "session_claim_tokens") {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { user_id: USER_ID }, error: null }),
          };
        }
        return {};
      }),
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: USER_ID, email: USER_EMAIL } },
            error: null,
          }),
          generateLink: vi.fn().mockResolvedValue({
            data: { properties: { hashed_token: "hashed-abc" } },
            error: null,
          }),
        },
      },
    });

    const app = new Hono();
    app.route("/api/auth/claim-session", claimSessionRoute);
    const res = await app.request("/api/auth/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_token: token }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token_hash).toBe("hashed-abc");
    expect(body.email).toBe(USER_EMAIL);
  });

  it("returns 410 when the token has already been redeemed", async () => {
    const { token } = await signClaimToken(USER_ID);
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    });
    const app = new Hono();
    app.route("/api/auth/claim-session", claimSessionRoute);
    const res = await app.request("/api/auth/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_token: token }),
    });
    expect(res.status).toBe(410);
  });

  it("returns 401 on invalid signature", async () => {
    const { token } = await signClaimToken(USER_ID);
    const tampered = token.slice(0, -4) + "AAAA";
    const app = new Hono();
    app.route("/api/auth/claim-session", claimSessionRoute);
    const res = await app.request("/api/auth/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim_token: tampered }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimSession.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement the route**

```ts
// pipeline/src/routes/claimSession.ts
/**
 * POST /api/auth/claim-session  (UNAUTHED)
 *
 * Exchanges a single-use session-claim JWT for a Supabase magic-link
 * token_hash. The mobile app calls supabase.auth.verifyOtp with the
 * returned token_hash + email to mint a real Supabase session.
 *
 * Flow:
 *   1. Verify JWT signature + expiry.
 *   2. CAS update on session_claim_tokens to mark redeemed_at — if
 *      zero rows returned, token was already used or never existed.
 *   3. Look up email by user_id via supabase.auth.admin.
 *   4. Call supabase.auth.admin.generateLink({type:'magiclink',email}).
 *   5. Return { token_hash, email }.
 *
 * Errors: 400 (bad body), 401 (bad sig / expired), 410 (already used),
 *         500 (admin call failure)
 */
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { verifyClaimToken } from "../lib/claimToken.js";

const route = new Hono();

route.post("/", async (c) => {
  let body: { claim_token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const claimToken = typeof body.claim_token === "string" ? body.claim_token : null;
  if (!claimToken) return c.json({ error: "missing claim_token" }, 400);

  let payload: Awaited<ReturnType<typeof verifyClaimToken>>;
  try {
    payload = await verifyClaimToken(claimToken);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // CAS redeem: only succeeds if redeemed_at is currently NULL
  const { data: redeemed, error: redeemErr } = await supabase
    .from("session_claim_tokens")
    .update({ redeemed_at: new Date().toISOString() })
    .eq("jti", payload.jti)
    .is("redeemed_at", null)
    .select("user_id")
    .single();
  if (redeemErr || !redeemed) {
    return c.json({ error: "already used or expired" }, 410);
  }

  // Look up the email for the user — generateLink needs it
  const { data: userResult, error: userErr } = await supabase.auth.admin.getUserById(payload.sub);
  if (userErr || !userResult.user?.email) {
    console.error("getUserById failed:", userErr);
    return c.json({ error: "internal" }, 500);
  }
  const email = userResult.user.email;

  // Mint a fresh magic link. The token_hash is what the client-side
  // verifyOtp consumes.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    console.error("generateLink failed:", linkErr);
    return c.json({ error: "internal" }, 500);
  }

  return c.json({ token_hash: linkData.properties.hashed_token, email });
});

export { route as claimSessionRoute };
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimSession.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Mount in server.ts**

Add to `pipeline/src/server.ts`:

```ts
import { claimSessionRoute } from "./routes/claimSession.js";
app.route("/api/auth/claim-session", claimSessionRoute);
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/claimSession.ts pipeline/tests/claimSession.test.ts pipeline/src/server.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): claim-session endpoint for app session handoff

Unauthed POST that verifies a session-claim JWT, atomically marks
it redeemed, and returns a fresh Supabase magic-link token_hash for
the mobile app to consume via verifyOtp. Tests cover happy path,
double-redeem (410), and tampered signature (401).
EOF
)"
```

### Task 15: well-known routes — AASA + assetlinks

**Files:**
- Create: `pipeline/src/routes/wellKnown.ts`
- Create: `pipeline/tests/wellKnown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/tests/wellKnown.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import { wellKnownRoute } from "../src/routes/wellKnown.js";

describe("well-known", () => {
  beforeEach(() => {
    process.env.APPLE_TEAM_ID = "ABC123XYZ";
    process.env.APP_BUNDLE_ID = "co.katavo.app";
    process.env.ANDROID_PACKAGE = "co.katavo.app";
    process.env.ANDROID_SHA256 = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
  });

  it("serves AASA at /.well-known/apple-app-site-association", async () => {
    const app = new Hono();
    app.route("/.well-known", wellKnownRoute);
    const res = await app.request("/.well-known/apple-app-site-association");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.applinks.details[0].appIDs).toEqual(["ABC123XYZ.co.katavo.app"]);
    expect(body.applinks.details[0].components).toEqual([{ "/": "/expand/*" }]);
  });

  it("serves assetlinks at /.well-known/assetlinks.json", async () => {
    const app = new Hono();
    app.route("/.well-known", wellKnownRoute);
    const res = await app.request("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].target.package_name).toBe("co.katavo.app");
    expect(body[0].target.sha256_cert_fingerprints).toEqual([
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    ]);
    expect(body[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/wellKnown.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement the route**

```ts
// pipeline/src/routes/wellKnown.ts
/**
 * Static well-known files for Universal Links / App Links.
 *   - /.well-known/apple-app-site-association   (AASA)
 *   - /.well-known/assetlinks.json              (Android Digital Asset Links)
 *
 * Values come from env so we can swap signing certs without redeploying
 * code. Cache-Control allows aggressive caching — iOS CDN polls this
 * occasionally; Android verifies on app install.
 */
import { Hono } from "hono";

const route = new Hono();

route.get("/apple-app-site-association", (c) => {
  const teamId = process.env.APPLE_TEAM_ID;
  const bundle = process.env.APP_BUNDLE_ID;
  if (!teamId || !bundle) {
    return c.json({ error: "not configured" }, 500);
  }
  c.header("Content-Type", "application/json");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundle}`],
          components: [{ "/": "/expand/*" }],
        },
      ],
    },
  });
});

route.get("/assetlinks.json", (c) => {
  const pkg = process.env.ANDROID_PACKAGE;
  const sha = process.env.ANDROID_SHA256;
  if (!pkg || !sha) {
    return c.json({ error: "not configured" }, 500);
  }
  c.header("Cache-Control", "public, max-age=3600");
  // ANDROID_SHA256 can be a single fingerprint OR comma-separated for
  // multiple (e.g. dev + prod signing certs).
  const fingerprints = sha.split(",").map((s) => s.trim()).filter(Boolean);
  return c.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: pkg,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

export { route as wellKnownRoute };
```

- [ ] **Step 4: Mount in server.ts**

```ts
import { wellKnownRoute } from "./routes/wellKnown.js";
app.route("/.well-known", wellKnownRoute);
```

- [ ] **Step 5: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/wellKnown.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/wellKnown.ts pipeline/tests/wellKnown.test.ts pipeline/src/server.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): well-known routes for Universal Links

AASA + assetlinks.json driven by APPLE_TEAM_ID, APP_BUNDLE_ID,
ANDROID_PACKAGE, ANDROID_SHA256 env vars. Path claim is /expand/*
only — share pages (/p/*) stay web-only. Tested via mocked env.
EOF
)"
```

### Task 16: Hourly cleanup cron for expired claim tokens

**Files:**
- Create: `pipeline/src/jobs/claimTokensCleanup.ts`
- Create: `pipeline/tests/claimTokensCleanup.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// pipeline/tests/claimTokensCleanup.test.ts
import { describe, expect, it, vi } from "vitest";
import { sweepExpiredClaimTokens } from "../src/jobs/claimTokensCleanup.js";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

describe("sweepExpiredClaimTokens", () => {
  it("deletes rows where expires_at < now() AND redeemed_at IS NULL", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ data: null, error: null, count: 7 });
    const lt = vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ then: deleteEq, lt: vi.fn() }) });
    const from = vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count: 7, error: null }),
        }),
      }),
    });
    const { createClient } = await import("@supabase/supabase-js");
    (createClient as any).mockReturnValue({ from });
    const result = await sweepExpiredClaimTokens();
    expect(result.deleted).toBe(7);
  });
});
```

- [ ] **Step 2: Run and fail**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimTokensCleanup.test.ts
```

- [ ] **Step 3: Implement**

```ts
// pipeline/src/jobs/claimTokensCleanup.ts
/**
 * Hourly sweep that deletes expired, unredeemed session_claim_tokens.
 * Cheap — the partial index makes the query fast.
 */
import { createClient } from "@supabase/supabase-js";

export async function sweepExpiredClaimTokens(): Promise<{ deleted: number }> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { count, error } = await supabase
    .from("session_claim_tokens")
    .delete({ count: "exact" })
    .lt("expires_at", new Date().toISOString())
    .is("redeemed_at", null);
  if (error) {
    console.error("[claim-tokens cleanup] failed:", error);
    return { deleted: 0 };
  }
  return { deleted: count ?? 0 };
}
```

- [ ] **Step 4: Wire to server.ts setInterval**

```ts
// pipeline/src/server.ts, near the bottom
import { sweepExpiredClaimTokens } from "./jobs/claimTokensCleanup.js";

setInterval(async () => {
  try {
    const r = await sweepExpiredClaimTokens();
    if (r.deleted > 0) console.log(`[claim-tokens cleanup] deleted ${r.deleted}`);
  } catch (err) {
    console.error("[claim-tokens cleanup] failed:", err);
  }
}, HOUR_MS);
```

- [ ] **Step 5: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/claimTokensCleanup.test.ts
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/jobs/claimTokensCleanup.ts pipeline/tests/claimTokensCleanup.test.ts pipeline/src/server.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): hourly sweep of expired claim tokens

Deletes session_claim_tokens rows past expires_at that were never
redeemed. Partial index on (expires_at) WHERE redeemed_at IS NULL
backs the query. Logged only when something was deleted.
EOF
)"
```

---

## Chunk 5: Web share page — auth modal + state transitions

This chunk transforms the existing share page from the dead-end "Expand in app" modal into the three-state acquisition flow. After this chunk: a user on the web can sign in, watch the cooking state, and tap "Open in app" to get to the Universal Link with the claim token.

### Task 17: Replace dead-end modal with auth panel + plumb chapter param

**Files:**
- Modify: `pipeline/src/routes/shareTemplate.ts` (large rewrite of the modal + script section)
- Modify: `pipeline/src/routes/sharePage.ts` (pass `?chapter=` through)

- [ ] **Step 1: Update shareTemplate to embed Supabase auth + State machine**

Read the existing template (~350 lines) and refactor the inline `<script>` to:

1. Initialize the Supabase JS client with anon key + URL passed in as data attributes
2. Replace the modal body with: "Sign in to make your own version" + three buttons (Apple, Google, Email)
3. On each button click, call `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: <share_page_url_with_chapter_param> } })` for Apple/Google, or `signInWithOtp({ email })` for Email
4. On page load: if URL has `?chapter=N` AND the user has an active Supabase session, automatically POST to `/api/share/clone-and-expand` and transition to State B
5. State B: render sticky cooking bar at top; subscribe to Realtime on `podcasts` table filtered by expansion id; on `status='complete'` event, transition to State C
6. State C: cooking bar flips to "ready", Open-in-app CTA becomes prominent

This is a large file change — bite-sized steps:

- [ ] **Step 1a: Add data attributes for Supabase keys**

In `shareTemplate.ts`'s `renderSharePage`, accept new fields on `ShareTemplateInput`:

```ts
export interface ShareTemplateInput {
  shareUrl: string;
  root: ShareEpisode;
  descendants: ShareEpisode[];
  defaultOgImage: string;
  supabaseUrl: string;          // NEW
  supabaseAnonKey: string;       // NEW
  shareToken: string;            // NEW — passed through for the API call
  initialChapter: number | null; // NEW — non-null if URL had ?chapter=N
}
```

Emit them on the body tag as data attributes so the inline script can read them:

```html
<body data-supabase-url="${htmlEscape(supabaseUrl)}" data-supabase-anon-key="${htmlEscape(supabaseAnonKey)}" data-share-token="${htmlEscape(shareToken)}" data-initial-chapter="${initialChapter ?? ''}">
```

- [ ] **Step 1b: Add the Supabase JS CDN script tag**

In `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

(Or pin to the specific minor version that matches our package.json — check `pipeline/package.json` to get the version we use server-side and pin to the same major.)

- [ ] **Step 1c: Replace the modal body**

Find the current expand modal markup. The body currently is "Open it up in the app" + App Store badges. Replace with:

```html
<p class="modal-eyebrow">Make your own version</p>
<h3 class="modal-title" id="modal-title">Sign in to expand this chapter.</h3>
<p class="modal-body">Your version lands in a brand-new Katavo library, in this same voice. One credit, free on signup.</p>
<div class="auth-buttons">
  <button type="button" data-auth="apple" class="auth-btn auth-apple">Continue with Apple</button>
  <button type="button" data-auth="google" class="auth-btn auth-google">Continue with Google</button>
  <input type="email" placeholder="you@example.com" class="auth-email-input" data-auth-email-input />
  <button type="button" data-auth="email" class="auth-btn auth-email">Email me a sign-in link</button>
</div>
<button type="button" class="modal-close" data-close-modal>Maybe later</button>
```

Add CSS for `.auth-btn`, `.auth-apple`, `.auth-google`, `.auth-email`, `.auth-email-input`, `.auth-buttons` — match the existing brand tokens (paper, ink, accent).

- [ ] **Step 1d: Replace the script section**

Rewrite the inline `<script>` to implement the state machine. Pseudocode:

```js
const supabase = window.supabase.createClient(
  document.body.dataset.supabaseUrl,
  document.body.dataset.supabaseAnonKey,
);
const SHARE_TOKEN = document.body.dataset.shareToken;
const INITIAL_CHAPTER = document.body.dataset.initialChapter
  ? parseInt(document.body.dataset.initialChapter, 10)
  : null;
const API_BASE = ""; // same-origin

let state = "anonymous"; // anonymous | cooking | ready
let expansionPodcastId = null;
let clonedParentId = null;

function setState(s) {
  state = s;
  document.body.dataset.state = s;
  renderStickyBar();
}

async function callCloneAndExpand(chapter) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return null;
  const res = await fetch("/api/share/clone-and-expand", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ share_token: SHARE_TOKEN, chapter_index: chapter }),
  });
  if (!res.ok) return null;
  return res.json();
}

function buildUniversalLink(chapter, claimToken, clonedParent) {
  const url = new URL(`/expand/${SHARE_TOKEN}/${chapter}`, location.origin);
  if (claimToken) url.searchParams.set("claim", claimToken);
  if (clonedParent) url.searchParams.set("p", clonedParent);
  return url.toString();
}

function renderStickyBar() {
  let bar = document.getElementById("sticky-cooking-bar");
  if (state === "anonymous") {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "sticky-cooking-bar";
    bar.className = "sticky-bar";
    document.body.prepend(bar);
  }
  if (state === "cooking") {
    bar.innerHTML = `<span>Your version is cooking…</span>` +
      `<a class="open-app" href="${buildUniversalLink(INITIAL_CHAPTER, sessionState.claimToken, clonedParentId)}">Open in app</a>`;
  }
  if (state === "ready") {
    bar.innerHTML = `<span>Your version is ready.</span>` +
      `<a class="open-app primary" href="${buildUniversalLink(INITIAL_CHAPTER, sessionState.claimToken, clonedParentId)}">Open in app to listen</a>`;
  }
}

let sessionState = { claimToken: null };

function subscribeToExpansion() {
  if (!expansionPodcastId) return;
  supabase
    .channel(`expansion-${expansionPodcastId}`)
    .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "podcasts", filter: `id=eq.${expansionPodcastId}` },
        (payload) => {
          if (payload.new.status === "complete") setState("ready");
        })
    .subscribe();
  // Fallback polling every 15s in case Realtime drops
  setInterval(async () => {
    if (state === "ready") return;
    const { data } = await supabase
      .from("podcasts")
      .select("status")
      .eq("id", expansionPodcastId)
      .maybeSingle();
    if (data?.status === "complete") setState("ready");
  }, 15_000);
}

// Modal auth handlers
document.addEventListener("click", async (ev) => {
  const authBtn = ev.target.closest("[data-auth]");
  if (!authBtn) return;
  const provider = authBtn.getAttribute("data-auth");
  const chapter = window.__PENDING_CHAPTER__ ?? INITIAL_CHAPTER ?? 0;
  const redirect = `${location.origin}/p/${SHARE_TOKEN}?chapter=${chapter}`;
  if (provider === "apple" || provider === "google") {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirect },
    });
  } else if (provider === "email") {
    const email = document.querySelector("[data-auth-email-input]").value.trim();
    if (!email) return;
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect },
    });
    document.querySelector(".modal-body").textContent =
      "Check your email — we sent you a link.";
  }
});

// Existing "Expand in app" chapter click handler
document.addEventListener("click", (ev) => {
  const expandBtn = ev.target.closest("[data-prompt-expand]");
  if (!expandBtn) return;
  const li = expandBtn.closest("li");
  const idx = Array.from(li.parentElement.children).indexOf(li);
  window.__PENDING_CHAPTER__ = idx;
  document.getElementById("expand-modal").setAttribute("aria-hidden", "false");
});

// On page load: if signed in AND chapter param present, kick off
(async () => {
  if (INITIAL_CHAPTER === null) return;
  const result = await callCloneAndExpand(INITIAL_CHAPTER);
  if (!result) return;
  expansionPodcastId = result.expansion_podcast_id;
  clonedParentId = result.cloned_parent_id;
  sessionState.claimToken = result.claim_token;
  setState("cooking");
  subscribeToExpansion();
})();
```

Add styles for `.sticky-bar`, `.open-app`, `.auth-*`. Keep the existing chapter list + audio player logic intact — they don't change.

- [ ] **Step 1e: Update sharePage.ts to pass new fields**

```ts
// pipeline/src/routes/sharePage.ts
const chapterParam = c.req.query("chapter");
const initialChapter = chapterParam && /^\d+$/.test(chapterParam)
  ? parseInt(chapterParam, 10)
  : null;

return c.html(renderSharePage({
  shareUrl,
  root,
  descendants,
  defaultOgImage,
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
  shareToken: token,
  initialChapter,
}));
```

- [ ] **Step 2: Update existing sharePage tests**

The existing `sharePage.test.ts` will fail because the template signature changed. Update mocks to pass the new fields. Add one new test:

```ts
it("emits data-initial-chapter when ?chapter= is in the URL", async () => {
  // ... assert the rendered HTML body tag has data-initial-chapter="2"
  //     when ?chapter=2 is passed
});
```

- [ ] **Step 3: Run tests**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npx vitest run tests/sharePage.test.ts
```

Expected: all pass.

- [ ] **Step 4: Manual smoke test in dev**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm run dev
```

Open `http://localhost:3000/p/<a-real-token>` in browser. Tap "Expand in app" — modal should show three auth buttons. Click Apple — should redirect (will fail because Apple OAuth needs prod config, that's fine). Click Email with a real email — should show "Check your email." Test that `?chapter=2` is preserved through the modal open.

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/shareTemplate.ts pipeline/src/routes/sharePage.ts pipeline/tests/sharePage.test.ts && git commit -m "$(cat <<'EOF'
feat(share-page): three-state acquisition flow

State A modal swaps the dead-end "download the app" body for
Apple/Google/Email sign-in. After auth the page resumes via the
?chapter= redirectTo param, calls /api/share/clone-and-expand,
transitions to State B (sticky cooking bar + Realtime subscription
+ 15s fallback poll), and flips to State C when the expansion's
status hits complete. Audio playback continues uninterrupted across
all three states.
EOF
)"
```

### Task 18: OAuth callback route + Universal Link static HTML fallback

**Files:**
- Modify: `pipeline/src/server.ts` (route registration; mostly a comment)
- Create: `pipeline/src/routes/universalLinkFallback.ts`

- [ ] **Step 1: Verify Supabase OAuth callback handling**

Supabase's JS client handles the OAuth callback by reading the `#access_token=...` URL fragment automatically when `supabase.auth.getSession()` is called on page load. Since the share page already loads Supabase JS, the share page itself IS the callback handler — no new route needed.

Confirm: when configuring the Supabase Auth providers (Apple/Google), the redirect URL is set to `https://katavoapp.com/p/*` (or whatever the share page domain is). This is done in the Supabase Dashboard, not in code, but document it.

- [ ] **Step 2: Implement the Universal Link fallback HTML**

When a user without the app taps `https://katavoapp.com/expand/<token>/<chapter>?claim=<jwt>`, iOS/Android show a plain web fetch of that URL. We serve a static HTML page that explains "Install Katavo, your podcast is waiting."

```ts
// pipeline/src/routes/universalLinkFallback.ts
import { Hono } from "hono";

const STORE_APP = "https://apps.apple.com/app/katavo/id0000000000";
const STORE_PLAY = "https://play.google.com/store/apps/details?id=co.katavo.app";

const route = new Hono();

route.get("/:shareToken/:chapterIndex", (c) => {
  const shareToken = c.req.param("shareToken");
  const chapterIndex = c.req.param("chapterIndex");
  const claim = c.req.query("claim") ?? "";
  const p = c.req.query("p") ?? "";
  // Preserve all params in store-bounce links — after install,
  // tapping the same URL re-routes via Universal Link.
  const universalUrl = `https://katavoapp.com/expand/${encodeURIComponent(shareToken)}/${encodeURIComponent(chapterIndex)}?claim=${encodeURIComponent(claim)}&p=${encodeURIComponent(p)}`;
  c.header("Cache-Control", "no-store");
  return c.html(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install Katavo · Your podcast is waiting</title>
<style>body{font-family:system-ui;margin:0;padding:32px;background:#FBF8F1;color:#1A1B1F;text-align:center}.badges{display:flex;gap:12px;justify-content:center;margin-top:24px;flex-wrap:wrap}.badges a{display:inline-block;width:160px;height:52px}.badges img{max-width:100%;max-height:100%}</style>
</head><body>
<h1>Install Katavo</h1>
<p>Your podcast is waiting in the app.</p>
<div class="badges">
  <a href="${STORE_APP}"><img src="/og/app-store.svg" alt="App Store" /></a>
  <a href="${STORE_PLAY}"><img src="/og/play-store.png" alt="Google Play" /></a>
</div>
<p style="margin-top:32px;font-size:13px;color:#84858C">Once installed, tap <a href="${universalUrl}">this link</a> again to open your podcast.</p>
</body></html>`);
});

export { route as universalLinkFallbackRoute };
```

- [ ] **Step 3: Mount in server.ts**

```ts
import { universalLinkFallbackRoute } from "./routes/universalLinkFallback.js";
app.route("/expand", universalLinkFallbackRoute);
```

Note: this route is ONLY hit when the app isn't installed (iOS/Android fall back to web on Universal Links). When the app IS installed, the OS intercepts before Hono sees the request.

- [ ] **Step 4: Manual smoke test**

```bash
curl http://localhost:3000/expand/abc123/2?claim=xyz | grep "Install Katavo"
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add pipeline/src/routes/universalLinkFallback.ts pipeline/src/server.ts && git commit -m "$(cat <<'EOF'
feat(pipeline): universal-link web fallback

When iOS/Android can't open katavoapp.com/expand/* in the Katavo
app (not installed yet), they fall back to a regular web fetch.
Serve a static "Install Katavo" page that preserves the claim and
parent params so a re-tap after install re-routes into the app.
EOF
)"
```

---

## Chunk 6: Mobile — Universal Link config + deep-link handler

After this chunk: the mobile app handles `https://katavoapp.com/expand/*` Universal Links, runs the truth-table logic (sign in / redeem / call clone-and-expand), and navigates to the cloned parent's player.

### Task 19: Universal Link config in app.config.ts

**Files:**
- Modify: `mobile/app.config.ts` (or `app.json` — check which is canonical)

- [ ] **Step 1: Identify which config file is active**

```bash
ls "/Users/isuru/personal/AI Podcast App/mobile/" | grep -E "app\.(json|config)"
```

If both exist, `app.config.ts` takes precedence. Otherwise edit `app.json`.

- [ ] **Step 2: Add iOS associatedDomains and Android intent-filter**

For iOS (in `app.config.ts` or `app.json` `ios` section):

```json
"associatedDomains": ["applinks:katavoapp.com"]
```

For Android (`android` section):

```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [
      { "scheme": "https", "host": "katavoapp.com", "pathPattern": "/expand/.*" }
    ],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

- [ ] **Step 3: Flag — requires new EAS dev build**

Universal Links / App Links require iOS to refetch the AASA on app install. Local Expo Go won't see them. Note in the implementation log: "After applying this config, run `eas build --profile development --platform ios` (and Android) before testing Universal Links."

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app.config.ts mobile/app.json && git commit -m "$(cat <<'EOF'
feat(mobile): Universal Link config for katavoapp.com/expand/*

iOS associatedDomains + Android intent-filter for the deep-link
handler. Requires a fresh EAS dev build before testing on device —
Expo Go can't pick up associated-domains changes.
EOF
)"
```

### Task 20: Deep link context hook

**Files:**
- Create: `mobile/src/hooks/useDeepLinkContext.ts`

- [ ] **Step 1: Implement**

```ts
// mobile/src/hooks/useDeepLinkContext.ts
/**
 * Persists the share_token + chapter_index that triggered the
 * deep-link entry. Survives the auth navigation so cold-install
 * users land back on the right tree after sign-in.
 *
 * Uses AsyncStorage so it survives a process kill (e.g., the OAuth
 * round trip on Android can occasionally relaunch the app).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useCallback } from "react";

const KEY = "pending-share-expansion-v1";

export type PendingExpansion = {
  shareToken: string;
  chapterIndex: number;
  storedAt: number; // ms epoch — cleared after 1h
};

export function useDeepLinkContext() {
  const [pending, setPending] = useState<PendingExpansion | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as PendingExpansion;
        // Expire after 1h so stale state doesn't haunt the next launch
        if (Date.now() - parsed.storedAt > 60 * 60 * 1000) {
          await AsyncStorage.removeItem(KEY);
          return;
        }
        setPending(parsed);
      } catch {
        await AsyncStorage.removeItem(KEY);
      }
    })();
  }, []);

  const stash = useCallback(async (shareToken: string, chapterIndex: number) => {
    const next: PendingExpansion = { shareToken, chapterIndex, storedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    setPending(next);
  }, []);

  const clear = useCallback(async () => {
    await AsyncStorage.removeItem(KEY);
    setPending(null);
  }, []);

  return { pending, stash, clear };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/hooks/useDeepLinkContext.ts && git commit -m "$(cat <<'EOF'
feat(mobile): useDeepLinkContext hook

Persists pending share_token + chapter_index across the auth
navigation so cold-install Universal Link users resume cleanly
after sign-in. 1h TTL so stale state doesn't haunt later launches.
EOF
)"
```

### Task 21: Mobile clone service — clone-and-expand + claim-session client

**Files:**
- Create: `mobile/src/services/clone.ts`

- [ ] **Step 1: Implement**

```ts
// mobile/src/services/clone.ts
/**
 * Client for /api/share/clone-and-expand and /api/auth/claim-session.
 */
import { supabase } from "../lib/supabase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL!;

export async function cloneAndExpand(
  shareToken: string,
  chapterIndex: number,
): Promise<{ cloned_parent_id: string; expansion_podcast_id: string } | { error: string; status: number }> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return { error: "no_session", status: 401 };
  const res = await fetch(`${API_BASE}/api/share/clone-and-expand`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ share_token: shareToken, chapter_index: chapterIndex }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? "unknown", status: res.status };
  }
  return res.json();
}

export async function claimSession(claimToken: string): Promise<
  | { token_hash: string; email: string }
  | { error: string; status: number }
> {
  const res = await fetch(`${API_BASE}/api/auth/claim-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim_token: claimToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? "unknown", status: res.status };
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/services/clone.ts && git commit -m "$(cat <<'EOF'
feat(mobile): clone service — clone-and-expand + claim-session clients
EOF
)"
```

### Task 22: Deep link handler screen (truth table)

**Files:**
- Create: `mobile/app/expand/[share_token]/[chapter_index].tsx`

- [ ] **Step 1: Implement the route**

```tsx
// mobile/app/expand/[share_token]/[chapter_index].tsx
/**
 * Universal Link entry point: https://katavoapp.com/expand/:share_token/:chapter_index?claim=&p=
 *
 * Truth-table logic:
 *   - current_user_id null, claim absent → route to sign-in, stash for resume
 *   - current_user_id null, claim present → redeem + verifyOtp → navigate
 *   - current_user_id matches claim.sub → skip redemption, navigate
 *   - current_user_id != claim.sub → confirm sheet: switch or stay
 *   - current_user_id present, claim absent → call clone-and-expand, navigate
 *
 * Renders a centered spinner with copy "Setting up your podcast…"
 * while the API calls resolve. Errors surface as a retry / sign-in CTA.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { decodeJwt } from "jose";
import { supabase } from "../../../src/lib/supabase";
import { cloneAndExpand, claimSession } from "../../../src/services/clone";
import { useDeepLinkContext } from "../../../src/hooks/useDeepLinkContext";

type Status = "working" | "session_mismatch" | "error";

export default function ExpandHandler() {
  const { share_token, chapter_index } = useLocalSearchParams<{ share_token: string; chapter_index: string }>();
  const search = useLocalSearchParams<{ claim?: string; p?: string }>();
  const router = useRouter();
  const { stash, clear } = useDeepLinkContext();

  const [status, setStatus] = useState<Status>("working");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const shareToken = String(share_token ?? "");
      const chapter = parseInt(String(chapter_index ?? "0"), 10);
      const claim = typeof search.claim === "string" ? search.claim : null;
      const p = typeof search.p === "string" ? search.p : null;

      const session = (await supabase.auth.getSession()).data.session;
      const currentUserId = session?.user?.id ?? null;

      // Decode claim's sub (client-side decode is fine — signature is
      // verified server-side on redemption).
      let claimSub: string | null = null;
      if (claim) {
        try {
          claimSub = (decodeJwt(claim) as any).sub ?? null;
        } catch {
          claimSub = null;
        }
      }

      // Case 1: cold install (no session), no claim → route to sign-in
      if (!currentUserId && !claim) {
        await stash(shareToken, chapter);
        router.replace("/(auth)/sign-in");
        return;
      }

      // Case 4: session present, claim mismatch → confirm sheet
      if (currentUserId && claimSub && currentUserId !== claimSub) {
        setStatus("session_mismatch");
        return;
      }

      // Case 2: no session, claim present → redeem
      // Case 3: session matches claim → skip redemption
      if (claim && !currentUserId) {
        const result = await claimSession(claim);
        if ("error" in result) {
          if (result.status === 410) {
            setErrorMsg("This link has already been used.");
            setStatus("error");
            return;
          }
          setErrorMsg("Could not redeem this link.");
          setStatus("error");
          return;
        }
        // verifyOtp to actually mint the session client-side
        const { error } = await supabase.auth.verifyOtp({
          type: "magiclink",
          token_hash: result.token_hash,
          email: result.email,
        });
        if (error) {
          setErrorMsg("Sign-in failed.");
          setStatus("error");
          return;
        }
      }

      // At this point we have a session. Either p was passed (clone
      // already done on web) or we need to call clone-and-expand.
      let targetPodcastId: string | null = p;
      if (!targetPodcastId) {
        const cloneResult = await cloneAndExpand(shareToken, chapter);
        if ("error" in cloneResult) {
          if (cloneResult.status === 401) {
            // Session somehow invalid — bounce to sign-in
            await stash(shareToken, chapter);
            router.replace("/(auth)/sign-in");
            return;
          }
          setErrorMsg("Could not set up your podcast.");
          setStatus("error");
          return;
        }
        targetPodcastId = cloneResult.cloned_parent_id;
      }

      await clear();
      router.replace(`/player/${targetPodcastId}`);
    })().catch((err) => {
      console.error("expand handler:", err);
      setErrorMsg("Something went wrong.");
      setStatus("error");
    });
  }, [share_token, chapter_index]);

  if (status === "session_mismatch") {
    return <SessionMismatchSheet
      onSwitch={() => {
        // Sign out, then re-run effect by replacing the same route
        supabase.auth.signOut().then(() => {
          router.replace(`/expand/${share_token}/${chapter_index}?claim=${search.claim ?? ""}&p=${search.p ?? ""}`);
        });
      }}
      onStay={() => {
        // Treat as existing-user path with no claim
        router.replace(`/expand/${share_token}/${chapter_index}`);
      }}
    />;
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{errorMsg ?? "Something went wrong."}</Text>
        <Pressable onPress={() => router.replace("/(auth)/sign-in")} style={styles.button}>
          <Text style={styles.buttonText}>Go to sign-in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.workingText}>Setting up your podcast…</Text>
    </View>
  );
}

function SessionMismatchSheet({ onSwitch, onStay }: { onSwitch: () => void; onStay: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>This link is for a different account.</Text>
      <Text style={styles.body}>Sign in as that account, or keep your current one and just clone the podcast into it.</Text>
      <Pressable onPress={onSwitch} style={styles.button}>
        <Text style={styles.buttonText}>Sign in as the other account</Text>
      </Pressable>
      <Pressable onPress={onStay} style={[styles.button, styles.secondaryButton]}>
        <Text style={styles.buttonText}>Keep current, clone here</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16, backgroundColor: "#FBF8F1" },
  workingText: { color: "#1A1B1F", marginTop: 12 },
  title: { fontSize: 22, fontWeight: "600", color: "#1A1B1F", textAlign: "center" },
  body: { fontSize: 14, color: "#84858C", textAlign: "center" },
  errorText: { fontSize: 16, color: "#1A1B1F", textAlign: "center", marginBottom: 16 },
  button: { backgroundColor: "#2D5040", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  secondaryButton: { backgroundColor: "#84858C" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
```

- [ ] **Step 2: Install `jose` for mobile (client-side JWT decode)**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx expo install jose
```

- [ ] **Step 3: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/expand mobile/package.json mobile/package-lock.json && git commit -m "$(cat <<'EOF'
feat(mobile): deep-link handler for /expand/:share_token/:chapter_index

Truth-table logic on session state × claim presence × identity
match. Cold install routes through sign-in with persisted context.
Claim present mints a fresh Supabase session via verifyOtp. Session
mismatch surfaces a confirm sheet. After resolution navigates to
/player/<cloned_parent_id>.
EOF
)"
```

### Task 23: Resume pending expansion after sign-in

**Files:**
- Modify: `mobile/app/(auth)/sign-in.tsx` (find the existing sign-in screen)

- [ ] **Step 1: Locate the sign-in success handler**

```bash
grep -rn "signInWithIdToken\|signInWithOAuth\|signInWithPassword" "/Users/isuru/personal/AI Podcast App/mobile/app/(auth)/"
```

- [ ] **Step 2: After successful sign-in, check for pending expansion**

In the sign-in success path, after the Supabase session is established:

```tsx
import { useDeepLinkContext } from "../../src/hooks/useDeepLinkContext";

// inside the component...
const { pending, clear } = useDeepLinkContext();

// after successful sign-in:
if (pending) {
  await clear();
  router.replace(`/expand/${pending.shareToken}/${pending.chapterIndex}`);
  return;
}
// otherwise: existing post-sign-in navigation (library or onboarding)
```

- [ ] **Step 3: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/\(auth\)/sign-in.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): resume pending expansion after sign-in

When the auth screen successfully signs in a user who came from a
share-link deep link (pending state stashed by useDeepLinkContext),
route them straight to /expand/... instead of the default
post-sign-in destination.
EOF
)"
```

---

## Chunk 7: Mobile — push permission sheet + cooking display verification

After this chunk: first-time cooking-view users get prompted for push permission once; the player UI confirms it handles cloned-parent descendants identically to native ones.

### Task 24: useProfile reads push_prompted_at

**Files:**
- Modify: `mobile/src/hooks/useProfile.ts`
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Add field to the row + camelCase shape**

In `useProfile.ts`, extend the row type and the camelCase shape:

```ts
type ProfileRow = {
  // ... existing fields
  push_prompted_at: string | null;
};

type Profile = {
  // ... existing fields
  pushPromptedAt: string | null;
};

function toProfile(row: ProfileRow): Profile {
  return {
    // ... existing
    pushPromptedAt: row.push_prompted_at,
  };
}
```

Add `push_prompted_at` to the `.from("profiles").select(...)` columns wherever rows pass through `toProfile`.

Add a mutation helper:

```ts
async function markPushPrompted(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("profiles").update({ push_prompted_at: new Date().toISOString() }).eq("id", user.id);
  await refresh();
}
return { profile, markPushPrompted, ...rest };
```

- [ ] **Step 2: Update types/database.ts**

Add `push_prompted_at: string | null` to the `profiles` Row + Update + Insert types.

- [ ] **Step 3: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/hooks/useProfile.ts mobile/src/types/database.ts && git commit -m "$(cat <<'EOF'
feat(mobile): push_prompted_at on profiles + markPushPrompted helper
EOF
)"
```

### Task 25: PushPermissionSheet component

**Files:**
- Create: `mobile/src/components/PushPermissionSheet.tsx`

- [ ] **Step 1: Implement**

```tsx
// mobile/src/components/PushPermissionSheet.tsx
/**
 * One-time bottom sheet asking for push notification permission on
 * first cooking view. Gated by profile.push_prompted_at — we set it
 * to now() on accept OR dismiss so it never re-appears.
 *
 * Uses the existing usePushNotifications hook for the actual permission
 * request. Brand colors match the share page.
 */
import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { useProfile } from "../hooks/useProfile";
import { usePushNotifications } from "../hooks/usePushNotifications";

export function PushPermissionSheet({ visible }: { visible: boolean }) {
  const { profile, markPushPrompted } = useProfile();
  const { requestPermission } = usePushNotifications();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible && profile && profile.pushPromptedAt === null) {
      setShow(true);
    }
  }, [visible, profile?.pushPromptedAt]);

  if (!show) return null;

  const onAllow = async () => {
    await requestPermission();
    await markPushPrompted();
    setShow(false);
  };

  const onDismiss = async () => {
    await markPushPrompted();
    setShow(false);
  };

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>Ping me when it's ready</Text>
          <Text style={styles.title}>We'll ping you the moment your podcast is ready.</Text>
          <Pressable onPress={onAllow} style={[styles.btn, styles.primary]}>
            <Text style={styles.primaryText}>Allow notifications</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={styles.btn}>
            <Text style={styles.secondaryText}>Maybe later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(26,27,31,0.45)" },
  sheet: { backgroundColor: "#FBF8F1", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "#2D5040", fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: "#1A1B1F" },
  btn: { paddingVertical: 14, alignItems: "center", borderRadius: 8 },
  primary: { backgroundColor: "#2D5040" },
  primaryText: { color: "#fff", fontWeight: "600" },
  secondaryText: { color: "#84858C" },
});
```

- [ ] **Step 2: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/components/PushPermissionSheet.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): PushPermissionSheet bottom sheet for cooking view

One-time prompt gated by profile.push_prompted_at. Marks prompted
on accept OR dismiss so it never re-appears either way. Uses
existing usePushNotifications.requestPermission.
EOF
)"
```

### Task 26: Mount PushPermissionSheet on cooking view

**Files:**
- Modify: `mobile/app/player/[id]/index.tsx` (or wherever the player route lives)

- [ ] **Step 1: Locate the player screen**

```bash
ls "/Users/isuru/personal/AI Podcast App/mobile/app/player/"
```

- [ ] **Step 2: Mount the sheet, gated on cooking-state detection**

Add a check: if any descendant of the parent podcast has `status='queued'` or `status='processing'`, we're on a cooking view. Mount `<PushPermissionSheet visible={anyDescendantCooking} />` near the top of the JSX.

Pseudocode:

```tsx
import { PushPermissionSheet } from "../../../src/components/PushPermissionSheet";

const anyDescendantCooking = useMemo(
  () => descendants.some((d) => d.status === "queued" || d.status === "processing"),
  [descendants],
);

return (
  <View>
    <PushPermissionSheet visible={anyDescendantCooking} />
    {/* existing player JSX */}
  </View>
);
```

- [ ] **Step 3: Verify player handles cloned-parent descendants**

Read the existing player code. The descendant query likely uses `.from("podcasts").select(...).eq("parent_podcast_id", id)`. Confirm there's no filter that excludes cloned rows (e.g., `cloned_from_share_token IS NULL`). Document the confirmation in the commit message.

- [ ] **Step 4: Typecheck**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app/player && git commit -m "$(cat <<'EOF'
feat(mobile): mount PushPermissionSheet on cooking view

Shown the first time the player loads with any queued/processing
descendant — which is exactly the shared-link cooking state.
Verified the existing player descendant query has no filter that
excludes cloned rows.
EOF
)"
```

---

## Chunk 8: End-to-end validation + deploy

After this chunk: the feature is verified on real iOS + Android devices against real Apple/Google OAuth + Supabase Realtime, env vars are set on Railway, AASA + assetlinks are served on the prod domain.

### Task 27: Env var setup on Railway

**Files:**
- None (env config only)

- [ ] **Step 1: Add new env vars to Railway**

Use the Railway MCP tools to set the following on the API server:

```
SESSION_CLAIM_JWT_SECRET=<output of `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`>
SHARE_PUBLIC_BASE_URL=https://katavoapp.com
APPLE_TEAM_ID=<from Apple Developer account>
APP_BUNDLE_ID=co.katavo.app
ANDROID_PACKAGE=co.katavo.app
ANDROID_SHA256=<from Android keystore — run `keytool -list -v -keystore <path> -alias <alias>`>
RESEND_API_KEY=<from Resend dashboard — leave unset to disable email>
EMAIL_FROM=noreply@katavoapp.com
```

- [ ] **Step 2: Verify**

Use `mcp__Railway__list-variables` to confirm all set.

### Task 28: Custom domain setup

**Files:**
- None (Railway / DNS config)

- [ ] **Step 1: Add custom domain `katavoapp.com` to Railway**

Configure CNAME / A records on the DNS provider to point at Railway. Wait for cert provisioning.

- [ ] **Step 2: Verify TLS**

```bash
curl -I https://katavoapp.com/health
```

Expected: 200 OK.

- [ ] **Step 3: Verify well-known files**

```bash
curl https://katavoapp.com/.well-known/apple-app-site-association | python3 -m json.tool
curl https://katavoapp.com/.well-known/assetlinks.json | python3 -m json.tool
```

Expected: valid JSON matching the test assertions.

- [ ] **Step 4: Verify Apple CDN fetches AASA**

Apple's CDN can take 24-48 hours to pick up AASA changes. Check status:

```bash
curl -X POST https://app-site-association.cdn-apple.com/a/v1/katavoapp.com
```

Returns the AASA Apple's CDN has cached. If empty, wait and retry.

### Task 29: Resend domain DKIM/SPF/DMARC

**Files:**
- None (DNS config only)

- [ ] **Step 1: Add Resend's DNS records to katavoapp.com**

Resend dashboard → Domains → Add `katavoapp.com` → follow DKIM/SPF/DMARC instructions. Add records via DNS provider.

- [ ] **Step 2: Verify Resend shows "Verified"**

If not verified after 30 min, debug DNS propagation. If this blocks the launch, set `RESEND_API_KEY=""` (empty) on Railway — the `sendClaimEmail` helper will return `email_not_configured` and the rest of the flow still works.

### Task 30: New EAS build + Universal Link smoke test

**Files:**
- None (build / device test)

- [ ] **Step 1: Build iOS dev client**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && eas build --profile development --platform ios
```

Wait for build to finish; install on real device.

- [ ] **Step 2: Test Universal Link reception**

On the iPhone, open Notes app, paste `https://katavoapp.com/expand/abc/0` (any URL matching the path). Tap and hold the link — Notes should offer "Open in Katavo." Tap. The app should launch and hit the deep-link handler.

If the option doesn't appear, double-check:
- AASA is reachable + valid JSON at `https://katavoapp.com/.well-known/apple-app-site-association`
- `applinks:katavoapp.com` is in `associatedDomains` in the latest build's Info.plist (`cat ios/Podcasts/Info.plist | grep associated`)
- Apple CDN has picked it up (`curl -X POST https://app-site-association.cdn-apple.com/a/v1/katavoapp.com`)

- [ ] **Step 3: Build Android dev client + smoke test**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && eas build --profile development --platform android
```

Install on device. Test similarly via a paste of the URL in any app that opens links.

### Task 31: End-to-end happy-path walkthrough

**Files:**
- None (manual test)

- [ ] **Step 1: New-user path**

Pre-condition: a complete podcast with at least one un-expanded chapter, share_token issued.

1. On a different device than your normal dev device, open Safari, navigate to the share URL `https://katavoapp.com/p/<token>`.
2. Tap "Expand in app" on chapter 2.
3. Auth modal appears. Tap "Continue with Apple."
4. Apple OAuth round-trips. Page reloads with `?chapter=2`.
5. Cooking bar appears at top: "Your version is cooking…" Audio of User A's original continues playing.
6. Check Resend dashboard — the "Your Katavo podcast is ready" email arrived.
7. Tap "Open in app" button. Either Universal Link routes to the app (if installed) OR App Store fallback page loads.
8. Install the app from store. Open the email link. App handles `/expand/<token>/2?claim=<jwt>&p=<cloned_parent>`.
9. Spinner: "Setting up your podcast…"
10. Lands on `/player/<cloned_parent>`. Chapter list shows spinner on chapter 2. Push permission sheet appears.
11. Wait ~3-10 min for the pipeline to complete. Push notification arrives. Chapter row flips to "Listen."

- [ ] **Step 2: Existing-user path**

Pre-condition: signed in to the Katavo app on the same device as Safari.

1. In iMessage on iOS, send yourself a link to `https://katavoapp.com/expand/<token>/2`.
2. Tap the link in iMessage. App opens directly to the spinner.
3. Backend runs clone-and-expand. ~5-10s.
4. Lands on `/player/<cloned_parent>` with chapter 2 cooking.

- [ ] **Step 3: Share-revoked-mid-flight**

1. Open the share page in Safari. Sign in.
2. Before tapping a chapter, revoke the share_token via the owner's app.
3. Tap "Expand in app." Web should show "This podcast is no longer shared."

- [ ] **Step 4: Document any failures**

If any path fails, capture screenshots + console logs and surface to the user before proceeding to deploy.

### Task 32: Pipeline-trace parity check

**Files:**
- None (manual telemetry inspection)

- [ ] **Step 1: Run clone-and-expand end-to-end**

Complete the new-user happy path above. Capture the expansion_podcast_id.

- [ ] **Step 2: Run a normal user-initiated expansion**

In the same account, manually generate a new expansion via the normal in-app flow on a different parent.

- [ ] **Step 3: Compare Langfuse traces**

Open Langfuse cloud dashboard. Both expansions should show:
- Same pipeline stages: briefBuilder → deepResearch → qualityGate → scriptWriter → adInjector → audioProducer → metadataWriter
- Same voice in the audioProducer span
- Same shape of input/output

Any divergence indicates a silent assumption about cloned-parent context that needs fixing. Common gotchas:
- briefBuilder reading a field that's null on cloned rows
- chapter_research_map shape differing between cloned and original research_contexts

- [ ] **Step 4: Final commit + tag**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git tag v21-shared-podcast-expansion-shipped && git push --tags
```

---

## Notes for the implementing engineer

- **Order matters within Chunk 3.** Task 9 writes the route that references `enqueuePipelineJob` (Task 13) and `deduct_credit_and_insert_expansion` (Task 10). Those two get implemented before Task 9's tests will pass — that's why Task 9 step 5 says "stage but don't commit yet."
- **The Supabase auth providers (Apple, Google) need to be configured in the Supabase Dashboard.** Tier-1 OAuth setup is outside this plan. Apple requires an App ID + Services ID + Sign-in-with-Apple capability. Google requires an OAuth client in GCP. Both need `https://katavoapp.com/p/*` as a permitted redirect URL.
- **Resend setup is the riskiest external dependency.** DKIM/SPF/DMARC propagation can take a few hours and is harder to debug from inside the implementation flow. If launch timing is tight, set `RESEND_API_KEY=""` to disable email and ship without it — the in-page CTA covers the happy path and email can land in a follow-up.
- **Apple Universal Links can take 24-48h for the AASA CDN to pick up the file after first deploy.** Set up the prod domain + AASA at least a day before the launch test. Confirm with `curl https://app-site-association.cdn-apple.com/a/v1/katavoapp.com`.
- **`profile.voice` permanent override.** The spec calls this out — when a fresh signup lands via a shared tree, their profile-wide voice default becomes the parent's voice. They can change it in Account. If product later wants per-tree voice isolation, the change is scoped to clone-and-expand step 7 (drop the `profile.voice` mutation, surface a voice picker on first manual generate).
- **Cloned tree size is uncapped.** A parent with 30 expansions clones all 30 (DB rows are cheap; the 30 × 3 = 90 storage copies cost a few seconds + a few cents). If we ever see abuse, cap on cloned_descendant count in the RPC.
