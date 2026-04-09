/**
 * POST /api/notify-complete
 *
 * Sends a push notification via Expo when a podcast completes or fails.
 * The HTTP route exists for external callers.
 *
 * For in-process callers (metadataWriter, errorHandler): import and call
 * sendPodcastNotification() directly — no HTTP overhead, no auth needed.
 *
 * Auth: internalAuth middleware (PIPELINE_CALLBACK_SECRET) for HTTP route only
 * Request body: { podcast_id, status, error_message? }
 * Response: { message: "Notification sent" }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { internalAuth } from "../middleware/auth.js";

const route = new Hono();

/**
 * Core notification logic — used by both the HTTP route and direct in-process callers.
 * Looks up the podcast and user's push token, then sends via Expo Push API.
 */
export async function sendPodcastNotification(
  podcastId: string,
  status: "complete" | "failed",
  errorMessage?: string,
): Promise<void> {
  const serviceClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: podcast } = await serviceClient
    .from("podcasts")
    .select("user_id, topic")
    .eq("id", podcastId)
    .single();

  if (!podcast) return;

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("expo_push_token")
    .eq("id", podcast.user_id)
    .single();

  if (!profile?.expo_push_token) return;

  const title =
    status === "complete" ? "Your podcast is ready!" : "Podcast generation failed";
  const body =
    status === "complete"
      ? `"${podcast.topic}" is ready to listen.`
      : `"${podcast.topic}" failed. Your credit has been refunded.`;

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: profile.expo_push_token,
      title,
      body,
      data: { podcast_id: podcastId, status },
      sound: "default",
    }),
  });
}

route.post("/", internalAuth, async (c) => {
  try {
    const { podcast_id, status, error_message } = await c.req.json();

    await sendPodcastNotification(podcast_id, status, error_message);

    return c.json({ message: "Notification sent" });
  } catch {
    return c.json({ error: "Failed to send notification" }, 500);
  }
});

export { route as notifyCompleteRoute };
