/**
 * Single source of truth for tier-level product facts and the editorial
 * copy used when switching between them.
 *
 * Server-side, pricing and entitlements live in RevenueCat / App Store
 * Connect. The values here are the user-facing display layer — what the
 * tier blocks on /plans render and what the SwitchTierSheet narrates as
 * the delta. Keep them in sync with RevenueCat dashboard pricing on
 * material changes.
 */
import { Platform } from "react-native";
import { PRODUCTS } from "../config/revenucat";

export type Tier = "free" | "plus" | "pro";

export interface TierInfo {
  id: Tier;
  name: string;
  priceLabel: string;
  facts: string[];
  extraCreditPrice: number;
  productId: string | null;
}

export const TIERS: Record<Tier, TierInfo> = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0/mo",
    facts: [
      "2 podcasts a month",
      "Ads in podcasts",
      "No Deep Dive",
      "Extra credit at $5",
    ],
    extraCreditPrice: 5,
    productId: null,
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceLabel: "$14.99/mo",
    facts: [
      "8 podcasts a month",
      "No ads",
      "15 min Deep Dive a month",
      "Extra credit at $4",
    ],
    extraCreditPrice: 4,
    productId: PRODUCTS.PLUS_MONTHLY,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$29.99/mo",
    facts: [
      "20 podcasts a month",
      "No ads",
      "45 min Deep Dive a month",
      "Deeper research per podcast",
      "Extra credit at $3",
    ],
    extraCreditPrice: 3,
    productId: PRODUCTS.PRO_MONTHLY,
  },
};

export const TIER_ORDER: Tier[] = ["free", "plus", "pro"];

/**
 * Display order for the /plans tier picker. Paid options are pushed to
 * the top so the upgrade path is obvious at a glance; the user's current
 * paid tier sits just above Free, which is always last. The result:
 *   Free user → Plus, Pro, Free
 *   Plus user → Pro, Plus, Free
 *   Pro user  → Plus, Pro, Free
 */
export function getDisplayOrder(currentTier: Tier): Tier[] {
  const paidAscending: Tier[] = ["plus", "pro"];
  const nonCurrentPaid = paidAscending.filter((t) => t !== currentTier);
  const currentPaid: Tier[] = currentTier === "free" ? [] : [currentTier];
  return [...nonCurrentPaid, ...currentPaid, "free"];
}

const TIER_RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

export type Direction = "upgrade" | "downgrade" | "same";

export function getDirection(from: Tier, to: Tier): Direction {
  const f = TIER_RANK[from];
  const t = TIER_RANK[to];
  if (t > f) return "upgrade";
  if (t < f) return "downgrade";
  return "same";
}

/**
 * Catalogue of paywalled features and the minimum tier each requires.
 * Single source of truth for locked-feature gating across the app — any
 * surface that needs to ask "is this feature available to me?" reads
 * from here so we never duplicate the tier comparison.
 *
 * Add new features here when they're introduced; UpgradeRow and any
 * future banner / pill variants pick up the new entry automatically.
 */
export type LockableFeature = "deepDive" | "noAds" | "cheaperCredits";

export const FEATURE_MIN_TIER: Record<LockableFeature, Tier> = {
  deepDive: "plus",
  noAds: "plus",
  cheaperCredits: "plus",
};

export function isFeatureUnlocked(
  feature: LockableFeature,
  tier: Tier,
): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

interface SwitchKey {
  from: Tier;
  to: Tier;
}

const DELTA_COPY: Record<string, string> = {
  "free->plus":
    "More podcasts (8), no ads, 15 minutes of Deep Dive, and cheaper extra credits ($4).",
  "free->pro":
    "More podcasts (20), no ads, 45 minutes of Deep Dive, and the cheapest extra credits ($3).",
  "plus->pro":
    "More podcasts (20), longer Deep Dive (45 min), and cheaper extra credits ($3).",
  "pro->plus":
    "Fewer podcasts (8), shorter Deep Dive (15 min), and slightly more for extra credits ($4).",
  "plus->free": "Ads return, no Deep Dive, and just 2 podcasts a month.",
  "pro->free": "Ads return, no Deep Dive, and just 2 podcasts a month.",
};

export function getDeltaCopy(from: Tier, to: Tier): string {
  return DELTA_COPY[`${from}->${to}`] ?? "";
}

export interface SwitchPlan {
  from: Tier;
  to: Tier;
  direction: Direction;
  /** Editorial title used by the sheet, e.g. "Plus to Pro." */
  title: string;
  /** One-paragraph diff of what changes. */
  delta: string;
  /** One-paragraph billing fact. */
  billing: string;
  /** Sheet primary CTA label. */
  ctaLabel: string;
  /**
   * "purchase" runs the in-app product change via RevenueCat.
   * "openStore" hands off to the system subscription manager (cancellation).
   * "none" — no action available (same tier, edge case).
   */
  action: "purchase" | "openStore" | "none";
}

function formatRenewal(iso: string | null | undefined): string {
  if (!iso) return "the end of your billing cycle";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the end of your billing cycle";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function getSwitchPlan(
  from: Tier,
  to: Tier,
  renewalDate: string | null,
): SwitchPlan {
  const direction = getDirection(from, to);
  const fromName = TIERS[from].name;
  const toName = TIERS[to].name;
  const toPrice = TIERS[to].priceLabel;
  const renewal = formatRenewal(renewalDate);

  const title = `${fromName} to ${toName}.`;
  const delta = getDeltaCopy(from, to);

  if (direction === "same") {
    return {
      from,
      to,
      direction,
      title,
      delta: "",
      billing: "",
      ctaLabel: "Done",
      action: "none",
    };
  }

  // Cancellation: paid → free runs through the system subscription
  // manager. App stores don't allow programmatic cancellation.
  if (to === "free") {
    return {
      from,
      to,
      direction,
      title: `Cancel ${fromName}.`,
      delta,
      billing: `We'll open ${Platform.OS === "ios" ? "iOS Settings" : "Play Store"} so you can cancel. You'll keep ${fromName} features until ${renewal}.`,
      ctaLabel: `Open ${Platform.OS === "ios" ? "Settings" : "Play Store"} to cancel`,
      action: "openStore",
    };
  }

  if (direction === "upgrade") {
    const billing =
      from === "free"
        ? `${toPrice}, charged today.`
        : `${toPrice}, charged today and prorated against your ${fromName}.`;
    return {
      from,
      to,
      direction,
      title,
      delta,
      billing,
      ctaLabel: "Confirm upgrade",
      action: "purchase",
    };
  }

  // In-app downgrade (paid → paid lower).
  return {
    from,
    to,
    direction,
    title,
    delta,
    billing: `${toPrice}, starting on ${renewal}. You'll keep ${fromName} features until then.`,
    ctaLabel: "Confirm downgrade",
    action: "purchase",
  };
}

/** Build the App Store / Play Store subscription management URL. */
export function getStoreSubscriptionUrl(): string {
  if (Platform.OS === "ios") {
    return "itms-apps://apps.apple.com/account/subscriptions";
  }
  return "https://play.google.com/store/account/subscriptions";
}
