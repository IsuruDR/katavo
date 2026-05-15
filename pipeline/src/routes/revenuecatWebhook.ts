/**
 * POST /api/revenucat-webhook
 *
 * Handles RevenueCat subscription events: initial purchase, renewal,
 * cancellation, billing issues, expiration, credit purchases, plan changes.
 *
 * Auth: webhookAuth middleware (REVENUCAT_WEBHOOK_SECRET)
 * Request body: RevenueCat webhook event payload
 * Response: { received: true }
 */

import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { webhookAuth } from "../middleware/auth.js";

const TIER_CONFIG: Record<
  string,
  { tier: string; credits: number; deepDiveMinutes: number }
> = {
  plus_monthly: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  plus_annual: { tier: "plus", credits: 8, deepDiveMinutes: 15 },
  pro_monthly: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
  pro_annual: { tier: "pro", credits: 20, deepDiveMinutes: 45 },
};

const route = new Hono();

route.post("/", webhookAuth, async (c) => {
  try {
    const event = await c.req.json();
    const eventId: string | undefined = event?.event?.id;
    const { type, app_user_id, product_id, expiration_at_ms } = event.event;

    const serviceClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // SEC-1: replay protection. RevenueCat retries on transient failures, and
    // a leaked webhook secret would let an attacker replay any captured payload
    // to grant credits or upgrade a subscription. webhook_events has event_id
    // as PK; the INSERT fails with 23505 on a duplicate and we short-circuit.
    if (eventId) {
      const { error: dedupeErr } = await serviceClient
        .from("webhook_events")
        .insert({ event_id: eventId, source: "revenuecat" });
      if (dedupeErr) {
        if (dedupeErr.code === "23505") {
          console.log(`webhook replay: ignoring duplicate event ${eventId}`);
          return c.json({ received: true, duplicate: true });
        }
        console.error("webhook dedupe insert failed:", dedupeErr);
        return c.json({ error: "Webhook dedupe failed" }, 500);
      }
    } else {
      console.warn("webhook missing event.id; cannot dedupe");
    }

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

        await serviceClient.from("credit_transactions").insert({
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
            credits_per_month: 2,
            credits_remaining: 2,
            deep_dive_minutes_per_month: 0,
            deep_dive_minutes_remaining: 0,
            revenucat_subscription_id: null,
          })
          .eq("user_id", userId);
        break;
      }

      case "NON_RENEWING_PURCHASE": {
        const creditTiers: Record<string, number> = {
          credit_free_5: 1,
          credit_plus_4: 1,
          credit_pro_3: 1,
        };

        const creditAmount = creditTiers[product_id];
        if (!creditAmount) break;

        const { data: sub } = await serviceClient
          .from("subscriptions")
          .select("credits_remaining")
          .eq("user_id", userId)
          .single();

        if (sub) {
          const { data: updatedSub, error: creditError } = await serviceClient
            .from("subscriptions")
            .update({
              credits_remaining: sub.credits_remaining + creditAmount,
            })
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
              const { data: retryUpdated } = await serviceClient
                .from("subscriptions")
                .update({
                  credits_remaining:
                    retrySub.credits_remaining + creditAmount,
                })
                .eq("user_id", userId)
                .eq("credits_remaining", retrySub.credits_remaining)
                .select("credits_remaining")
                .single();

              if (!retryUpdated) {
                console.error(
                  `CRITICAL: Failed to add credit for user ${userId} product ${product_id} after retry`,
                );
                return c.json(
                  { error: "Credit allocation failed, please retry" },
                  500,
                );
              }
            }
          }

          const priceMap: Record<string, number> = {
            credit_free_5: 5.0,
            credit_plus_4: 4.0,
            credit_pro_3: 3.0,
          };

          await serviceClient.from("credit_transactions").insert({
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

        const tierRank: Record<string, number> = {
          free: 0,
          plus: 1,
          pro: 2,
        };
        const isUpgrade =
          tierRank[config.tier] > tierRank[current?.tier || "free"];

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
        } else {
          console.log(
            `PRODUCT_CHANGE downgrade pending for user ${userId}: ` +
              `current=${current?.tier || "free"} -> new=${config.tier}. ` +
              `Will apply at next renewal.`,
          );
        }
        break;
      }
    }

    return c.json({ received: true });
  } catch {
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

export { route as revenuecatWebhookRoute };
