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
