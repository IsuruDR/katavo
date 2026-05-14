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
