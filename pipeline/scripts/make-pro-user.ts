/**
 * Admin utility: upgrade a user to Pro tier.
 *
 * Run: cd pipeline && npx tsx scripts/make-pro-user.ts <user-id>
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or .env)
 *
 * Sets the user's subscription to Pro defaults: tier=pro, credits=20/20,
 * deep_dive_minutes=45/45, status=active. Same shape as the RevenueCat
 * webhook applies for an INITIAL_PURCHASE pro_monthly event.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export async function makePro(userId: string): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from("subscriptions")
    .update({
      tier: "pro",
      status: "active",
      credits_per_month: 20,
      credits_remaining: 20,
      deep_dive_minutes_per_month: 45,
      deep_dive_minutes_remaining: 45,
    })
    .eq("user_id", userId)
    .select("user_id, tier, credits_remaining, deep_dive_minutes_remaining, status")
    .single();

  if (error) throw new Error(`Pro upgrade failed: ${error.message}`);
  if (!data) throw new Error(`No subscription found for user ${userId}`);

  console.log("Pro upgrade applied:");
  console.log(`  tier:                       ${data.tier}`);
  console.log(`  credits_remaining:          ${data.credits_remaining}`);
  console.log(`  deep_dive_minutes_remaining: ${data.deep_dive_minutes_remaining}`);
  console.log(`  status:                     ${data.status}`);
}

// Run as CLI when invoked directly (not when imported).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: npx tsx scripts/make-pro-user.ts <user-id>");
    process.exit(1);
  }
  makePro(userId).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
