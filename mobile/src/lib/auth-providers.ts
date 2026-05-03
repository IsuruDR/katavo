/**
 * Native social sign-in wrappers. Each function:
 *   1. Triggers the iOS native sheet via the appropriate library
 *   2. Exchanges the returned identity token with Supabase via signInWithIdToken
 *   3. Returns any display name we can extract on first sign-in (caller persists)
 *
 * Cancellation throws — callers should silence the cancellation error code
 * but propagate everything else.
 */

import * as AppleAuthentication from "expo-apple-authentication";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { supabase } from "./supabase";

let googleConfigured = false;

function ensureGoogleConfigured(): void {
  if (googleConfigured) return;
  GoogleSignin.configure({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID!,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
    scopes: ["profile", "email"],
  });
  googleConfigured = true;
}

export async function signInWithApple(): Promise<{ displayName?: string }> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) {
    throw new Error("Apple sign-in returned no identity token");
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
  });
  if (error) throw error;

  // First-tap-only: Apple gives fullName once. Subsequent taps return null.
  const fullName = credential.fullName;
  const displayName = [fullName?.givenName, fullName?.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return { displayName: displayName || undefined };
}

export async function signInWithGoogle(): Promise<{ displayName?: string }> {
  ensureGoogleConfigured();
  // hasPlayServices() is a no-op on iOS but generates a benign log line.
  // We keep the call for cross-platform correctness if Android ships later.
  await GoogleSignin.hasPlayServices();
  const userInfo = await GoogleSignin.signIn();
  // v14+ uses userInfo.data.idToken; older majors used userInfo.idToken.
  // Fallback covers both shapes.
  const idToken =
    (userInfo as { data?: { idToken?: string } }).data?.idToken ??
    (userInfo as { idToken?: string }).idToken;
  if (!idToken) {
    throw new Error("Google sign-in returned no ID token");
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;

  const userPayload =
    (userInfo as { data?: { user?: { name?: string } } }).data?.user ??
    (userInfo as { user?: { name?: string } }).user;
  return { displayName: userPayload?.name ?? undefined };
}

export function isCancellationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string | number }).code;
  // Apple's expo-apple-authentication throws code "ERR_REQUEST_CANCELED"
  // Google's library uses statusCodes.SIGN_IN_CANCELLED
  return (
    code === "ERR_REQUEST_CANCELED" || code === statusCodes.SIGN_IN_CANCELLED
  );
}

export { statusCodes as googleStatusCodes };
