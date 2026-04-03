// supabase/functions/submit-podcast/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LANGGRAPH_API_URL = Deno.env.get("LANGGRAPH_API_URL")!;
const LANGGRAPH_API_KEY = Deno.env.get("LANGGRAPH_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { topic, clarifying_answers, trusted_source_id } = await req.json();

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: subscription } = await serviceClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!subscription) {
      return new Response(
        JSON.stringify({ error: "No credits remaining. Purchase more credits to continue." }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    const tierLimits: Record<string, number> = { free: 1, plus: 2, pro: 3 };
    const maxConcurrent = tierLimits[subscription.tier] || 1;

    const { count } = await serviceClient
      .from("podcasts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "researching", "fact_checking", "scripting", "generating_audio"]);

    if ((count || 0) >= maxConcurrent) {
      return new Response(
        JSON.stringify({ error: `Maximum ${maxConcurrent} concurrent generations allowed. Please wait for current podcasts to finish.` }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const hasAds = subscription.tier === "free";

    // Atomic credit deduction: only succeeds if credits_remaining > 0
    const { data: updatedSub, error: deductError } = await serviceClient
      .from("subscriptions")
      .update({ credits_remaining: subscription.credits_remaining - 1 })
      .eq("user_id", user.id)
      .gt("credits_remaining", 0)
      .select("credits_remaining")
      .single();

    if (deductError || !updatedSub) {
      return new Response(
        JSON.stringify({ error: "No credits remaining. Purchase more credits to continue." }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: podcast, error: insertError } = await serviceClient
      .from("podcasts")
      .insert({
        user_id: user.id,
        topic,
        clarifying_answers: clarifying_answers || [],
        status: "queued",
        has_ads: hasAds,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    await serviceClient
      .from("credit_transactions")
      .insert({
        user_id: user.id,
        type: "deduction",
        amount: -1,
        podcast_id: podcast.id,
      });

    let trustedSourceUrls: string[] = [];
    if (trusted_source_id && subscription.tier === "pro") {
      const { data: sources } = await serviceClient
        .from("trusted_sources")
        .select("urls")
        .eq("id", trusted_source_id)
        .eq("user_id", user.id)
        .single();
      if (sources) {
        trustedSourceUrls = sources.urls.map((s: { url: string }) => s.url);
      }
    }

    const lgResponse = await fetch(`${LANGGRAPH_API_URL}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": LANGGRAPH_API_KEY,
      },
      body: JSON.stringify({
        assistant_id: "podcast_pipeline",
        input: {
          podcast_id: podcast.id,
          user_id: user.id,
          topic,
          clarifying_answers: clarifying_answers || [],
          has_ads: hasAds,
          trusted_source_urls: trustedSourceUrls,
          tier: subscription.tier,
        },
      }),
    });

    const lgData = await lgResponse.json();

    await serviceClient
      .from("podcasts")
      .update({ langgraph_run_id: lgData.run_id })
      .eq("id", podcast.id);

    return new Response(
      JSON.stringify({ podcast_id: podcast.id, status: "queued" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to submit podcast" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
