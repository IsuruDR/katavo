// mobile/src/config/revenucat.ts
/**
 * RevenueCat product and entitlement configuration.
 * Product IDs must match those configured in RevenueCat dashboard
 * and App Store Connect / Google Play Console.
 */

export const REVENUCAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUCAT_IOS_KEY!;
export const REVENUCAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUCAT_ANDROID_KEY!;

// Subscription product IDs
export const PRODUCTS = {
  PLUS_MONTHLY: "plus_monthly",
  PLUS_ANNUAL: "plus_annual",
  PRO_MONTHLY: "pro_monthly",
  PRO_ANNUAL: "pro_annual",
} as const;

// Consumable credit product IDs (per-tier pricing)
export const CREDIT_PRODUCTS = {
  CREDIT_FREE: "credit_free_5",     // $5 credit for free tier
  CREDIT_PLUS: "credit_plus_4",     // $4 credit for plus tier
  CREDIT_PRO: "credit_pro_3",       // $3 credit for pro tier
} as const;

// Entitlement identifiers
export const ENTITLEMENTS = {
  PLUS: "plus_access",
  PRO: "pro_access",
} as const;
