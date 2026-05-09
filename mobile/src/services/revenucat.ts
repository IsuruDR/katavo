// mobile/src/services/revenucat.ts
import { Platform } from "react-native";
import Purchases, {
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
} from "react-native-purchases";
import {
  REVENUCAT_API_KEY_IOS,
  REVENUCAT_API_KEY_ANDROID,
  ENTITLEMENTS,
  CREDIT_PRODUCTS,
} from "../config/revenucat";

let isConfigured = false;

export async function configureRevenueCat(userId: string) {
  if (isConfigured) return;

  const apiKey = Platform.OS === "ios" ? REVENUCAT_API_KEY_IOS : REVENUCAT_API_KEY_ANDROID;

  Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  await Purchases.configure({ apiKey, appUserID: userId });
  isConfigured = true;
}

export async function getOfferings() {
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/**
 * Resolve the package for a paid tier and run the in-app purchase.
 * RevenueCat handles upgrade vs same-group downgrade transparently — the
 * caller doesn't need to differentiate. Throws on user cancellation
 * (error.userCancelled === true) and on configuration errors (offering
 * missing, package missing). The caller is responsible for refreshing
 * subscription state on success.
 */
export async function purchaseTier(productId: string): Promise<CustomerInfo> {
  const offering = await getOfferings();
  if (!offering) {
    throw new Error("No subscription offering is currently available.");
  }
  const pkg = offering.availablePackages.find(
    (p) => p.product.identifier === productId,
  );
  if (!pkg) {
    throw new Error(`No package found for ${productId}.`);
  }
  return purchasePackage(pkg);
}

export async function purchaseCredit(tier: "free" | "plus" | "pro"): Promise<CustomerInfo> {
  const productId = {
    free: CREDIT_PRODUCTS.CREDIT_FREE,
    plus: CREDIT_PRODUCTS.CREDIT_PLUS,
    pro: CREDIT_PRODUCTS.CREDIT_PRO,
  }[tier];

  const { customerInfo } = await Purchases.purchaseProduct(productId);
  return customerInfo;
}

export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export function hasProAccess(info: CustomerInfo): boolean {
  return typeof info.entitlements.active[ENTITLEMENTS.PRO] !== "undefined";
}

export function hasPlusAccess(info: CustomerInfo): boolean {
  return (
    typeof info.entitlements.active[ENTITLEMENTS.PLUS] !== "undefined" ||
    hasProAccess(info)
  );
}
