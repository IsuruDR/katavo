/**
 * Admin utility: reset a user to a fresh-signup state. Wipes their podcasts,
 * credit ledger, push token, and voice preference, then sets the subscription
 * to either free (default) or pro (delegates to make-pro-user.ts).
 *
 * Run:
 *   cd pipeline && npx tsx scripts/reset-user.ts <user-id>
 *   cd pipeline && npx tsx scripts/reset-user.ts <user-id> --tier=free
 *   cd pipeline && npx tsx scripts/reset-user.ts <user-id> --tier=pro
 *
 * If --tier is omitted, prompts interactively.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or .env)
 *
 * Destructive: wipes all the user's podcasts (FK cascade also clears
 * research_contexts and qa_sessions), credit_transactions, and resets
 * profile.preferred_voice + expo_push_token to NULL plus
 * onboarding_complete + has_used_expand to FALSE so the next app launch
 * runs onboarding and the first generated podcast plays the coach-mark.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { makePro } from "./make-pro-user.js";

type Tier = "free" | "pro";

async function resetUser(userId: string, tier: Tier): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Sanity-check the user exists before destroying anything.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) {
    throw new Error(`User not found in profiles: ${userId}`);
  }

  console.log(`Resetting ${profile.display_name ?? userId}...`);

  // Wipe podcasts (FK cascade clears research_contexts + qa_sessions).
  const { error: podErr } = await supabase
    .from("podcasts")
    .delete()
    .eq("user_id", userId);
  if (podErr) throw new Error(`Delete podcasts failed: ${podErr.message}`);
  console.log("  ✓ podcasts deleted (cascade: research_contexts, qa_sessions)");

  // Wipe credit ledger so the new balance is the source of truth.
  const { error: txErr } = await supabase
    .from("credit_transactions")
    .delete()
    .eq("user_id", userId);
  if (txErr) throw new Error(`Delete credit_transactions failed: ${txErr.message}`);
  console.log("  ✓ credit_transactions deleted");

  // Reset profile to fresh-signup defaults: clear voice + push token,
  // flip onboarding_complete + has_used_expand back to false. Matches the
  // handle_new_user trigger so the next app launch goes through onboarding
  // and the coach-mark fires on the first generated podcast.
  const { error: profUpdateErr } = await supabase
    .from("profiles")
    .update({
      preferred_voice: null,
      expo_push_token: null,
      onboarding_complete: false,
      has_used_expand: false,
    })
    .eq("id", userId);
  if (profUpdateErr)
    throw new Error(`Profile reset failed: ${profUpdateErr.message}`);
  console.log(
    "  ✓ profile reset (voice + push token cleared, onboarding_complete=false, has_used_expand=false)",
  );

  // Reset subscription to fresh free defaults — matches handle_new_user trigger.
  const { error: subErr } = await supabase
    .from("subscriptions")
    .update({
      tier: "free",
      status: "active",
      billing_period: "monthly",
      credits_per_month: 2,
      credits_remaining: 2,
      bonus_credits: 1,
      deep_dive_minutes_per_month: 0,
      deep_dive_minutes_remaining: 0,
      renewal_date: null,
      revenucat_subscription_id: null,
    })
    .eq("user_id", userId);
  if (subErr) throw new Error(`Subscription reset failed: ${subErr.message}`);
  console.log("  ✓ subscription reset to free (2/2 monthly + 1 bonus credit, 0/0 deep dive)");

  if (tier === "pro") {
    console.log("\nApplying Pro upgrade via make-pro-user.ts...");
    await makePro(userId);
  } else {
    console.log("\nDone. User is now a fresh free-tier signup.");
  }
}

async function promptTier(): Promise<Tier> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("Tier [free/pro]: ")).trim().toLowerCase();
    if (answer === "pro" || answer === "p") return "pro";
    if (answer === "free" || answer === "f" || answer === "") return "free";
    throw new Error(`Invalid tier "${answer}". Use "free" or "pro".`);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error(
      "Usage: npx tsx scripts/reset-user.ts <user-id> [--tier=free|pro]",
    );
    process.exit(1);
  }

  const tierArg = process.argv.find((a) => a.startsWith("--tier="));
  let tier: Tier;
  if (tierArg) {
    const value = tierArg.split("=")[1];
    if (value !== "free" && value !== "pro") {
      throw new Error(`Invalid --tier "${value}". Use --tier=free or --tier=pro.`);
    }
    tier = value;
  } else {
    tier = await promptTier();
  }

  await resetUser(userId, tier);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
