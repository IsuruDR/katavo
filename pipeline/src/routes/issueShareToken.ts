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
      if (updateErr.code === "23505") continue;
      return c.json({ error: "issue failed" }, 500);
    }

    if (count === 0) {
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
