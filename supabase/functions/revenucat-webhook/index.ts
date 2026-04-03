// supabase/functions/revenucat-webhook/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REVENUCAT_WEBHOOK_SECRET = Deno.env.get("REVENUCAT_WEBHOOK_SECRET")!;

const TIER_CONFIG: Record<
  string,
  { tier: string; credits: number; deepDiveMinutes: number }
> = {
  "plus_monthly": { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  "plus_annual": { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  "pro_monthly": { tier: "pro", credits: 20, deepDiveMinutes: 45 },
  "pro_annual": { tier: "pro", credits: 20, deepDiveMinutes: 45 },
};

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${REVENUCAT_WEBHOOK_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const event = await req.json();
    const { type, app_user_id, product_id, expiration_at_ms } = event.event;

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userId = app_user_id;

    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        const config = TIER_CONFIG[product_id];
        if (!config) break;

        await serviceClient
          .from("subscriptions")
          .update({
            tier: config.tier,
            status: "active",
            credits_per_month: config.credits,
            credits_remaining: config.credits,
            deep_dive_minutes_per_month: config.deepDiveMinutes,
            deep_dive_minutes_remaining: config.deepDiveMinutes,
            renewal_date: expiration_at_ms
              ? new Date(expiration_at_ms).toISOString()
              : null,
            revenucat_subscription_id: event.event.id,
          })
          .eq("user_id", userId);

        await serviceClient
          .from("credit_transactions")
          .insert({
            user_id: userId,
            type: "allocation",
            amount: config.credits,
          });
        break;
      }

      case "CANCELLATION": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("user_id", userId);
        break;
      }

      case "BILLING_ISSUE": {
        await serviceClient
          .from("subscriptions")
          .update({ status: "billing_issue" })
          .eq("user_id", userId);
        break;
      }

      case "EXPIRATION": {
        await serviceClient
          .from("subscriptions")
          .update({
            tier: "free",
            status: "active",
            credits_per_month: 1,
            credits_remaining: 1,
            deep_dive_minutes_per_month: 0,
            deep_dive_minutes_remaining: 0,
            revenucat_subscription_id: null,
          })
          .eq("user_id", userId);
        break;
      }

      case "NON_RENEWING_PURCHASE": {
        // Consumable credit purchase
        const creditTiers: Record<string, number> = {
          "credit_free_5": 1,
          "credit_plus_4": 1,
          "credit_pro_3": 1,
        };

        const creditAmount = creditTiers[product_id];
        if (!creditAmount) break;

        // Atomic credit addition with optimistic concurrency check
        const { data: sub } = await serviceClient
          .from("subscriptions")
          .select("credits_remaining")
          .eq("user_id", userId)
          .single();

        if (sub) {
          const { data: updatedSub, error: creditError } = await serviceClient
            .from("subscriptions")
            .update({ credits_remaining: sub.credits_remaining + creditAmount })
            .eq("user_id", userId)
            .eq("credits_remaining", sub.credits_remaining)
            .select("credits_remaining")
            .single();

          if (creditError || !updatedSub) {
            // Retry once on concurrent modification
            const { data: retrySub } = await serviceClient
              .from("subscriptions")
              .select("credits_remaining")
              .eq("user_id", userId)
              .single();

            if (retrySub) {
              await serviceClient
                .from("subscriptions")
                .update({ credits_remaining: retrySub.credits_remaining + creditAmount })
                .eq("user_id", userId)
                .eq("credits_remaining", retrySub.credits_remaining);
            }
          }

          // Record transaction
          const priceMap: Record<string, number> = {
            "credit_free_5": 5.00,
            "credit_plus_4": 4.00,
            "credit_pro_3": 3.00,
          };

          await serviceClient
            .from("credit_transactions")
            .insert({
              user_id: userId,
              type: "purchase",
              amount: creditAmount,
              price_paid: priceMap[product_id] || 0,
            });
        }
        break;
      }

      case "PRODUCT_CHANGE": {
        const config = TIER_CONFIG[product_id];
        if (!config) break;

        const { data: current } = await serviceClient
          .from("subscriptions")
          .select("tier")
          .eq("user_id", userId)
          .single();

        const tierRank: Record<string, number> = { free: 0, plus: 1, pro: 2 };
        const isUpgrade = tierRank[config.tier] > tierRank[current?.tier || "free"];

        if (isUpgrade) {
          await serviceClient
            .from("subscriptions")
            .update({
              tier: config.tier,
              credits_per_month: config.credits,
              credits_remaining: config.credits,
              deep_dive_minutes_per_month: config.deepDiveMinutes,
              deep_dive_minutes_remaining: config.deepDiveMinutes,
            })
            .eq("user_id", userId);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
