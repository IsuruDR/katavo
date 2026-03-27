// supabase/functions/notify-complete/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN")!;

serve(async (req) => {
  try {
    const { podcast_id, status, error_message } = await req.json();

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: podcast } = await serviceClient
      .from("podcasts")
      .select("user_id, topic")
      .eq("id", podcast_id)
      .single();

    if (!podcast) {
      return new Response(
        JSON.stringify({ error: "Podcast not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("expo_push_token")
      .eq("id", podcast.user_id)
      .single();

    if (!profile?.expo_push_token) {
      return new Response(
        JSON.stringify({ message: "No push token, skipping notification" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const title = status === "complete"
      ? "Your podcast is ready!"
      : "Podcast generation failed";
    const body = status === "complete"
      ? `"${podcast.topic}" is ready to listen.`
      : `"${podcast.topic}" failed. Your credit has been refunded.`;

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${EXPO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: profile.expo_push_token,
        title,
        body,
        data: { podcast_id, status },
        sound: "default",
      }),
    });

    return new Response(
      JSON.stringify({ message: "Notification sent" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to send notification" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
