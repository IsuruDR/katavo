# v10 — Social Login (Apple + Google) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Sign in with Apple and Google sign-in to the existing email/password auth, with auto-linking across providers when emails match.

**Architecture:** Two new native modules (`expo-apple-authentication`, `@react-native-google-signin/google-signin`) call the iOS native sheets, return identity tokens, which we exchange for a Supabase session via `signInWithIdToken`. Email/password stays as a fallback. Most of the work is dashboard configuration (Apple Developer, Google Cloud, Supabase) — code changes are concentrated in 4 files.

**Tech Stack:** React Native + Expo SDK 55 (canary), expo-apple-authentication, @react-native-google-signin/google-signin, Supabase Auth (signInWithIdToken).

**Spec:** `docs/superpowers/specs/2026-05-03-social-login-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `mobile/package.json` + `package-lock.json` | Add the two native modules via `expo install` (resolves SDK-compatible versions) |
| Modify | `mobile/app.json` | Add `usesAppleSignIn`, Google reversed-client-ID URL scheme, two plugin entries |
| Modify | `mobile/.env` | Add `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` + `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| Create | `mobile/src/lib/auth-providers.ts` | Wraps both native sign-in calls, exchanges tokens with Supabase, returns first-time display names |
| Modify | `mobile/src/hooks/useAuth.tsx` | Add `signInWithApple` + `signInWithGoogle` to `AuthContextType`, the AuthProvider body, and the Provider value prop |
| Modify | `mobile/app/(auth)/sign-in.tsx` | Add Apple/Google buttons + handleApple/handleGoogle wrappers above the email form |
| Modify | `mobile/app/(auth)/sign-up.tsx` | Same buttons; only render on the form state, not the post-submit "check your email" state |
| Create | `mobile/src/components/GoogleButton.tsx` | Pill-styled Google-branded button matching the project's design system |

No DB migrations. No server-side changes. The existing `handle_new_user` trigger auto-creates profile + free subscription regardless of whether signup came from email/password or OAuth.

---

## Chunk 1: Dashboard Configuration (manual user steps)

These steps must complete before any code can be tested end-to-end. The implementer will guide the user through them rather than performing them via API.

### Task 1: Apple Developer — capability + .p8 key

**Files:** none (external).

- [ ] **Step 1: Enable Sign in with Apple capability**

Surface to user:
> 1. Go to https://developer.apple.com/account/resources/identifiers/list
> 2. Find App ID `co.katavo.app` and tap it.
> 3. Scroll to **Sign in with Apple** in the Capabilities list, check the box, tap **Configure** if needed (default settings are fine), then **Save**.
> 4. Confirm the change saved without errors.

- [ ] **Step 2: Create the Sign in with Apple Key**

Surface to user:
> 1. Go to https://developer.apple.com/account/resources/authkeys/list
> 2. Tap **+** to register a new key.
> 3. Give it a name like `Katavo Sign in with Apple`.
> 4. Check **Sign in with Apple**, tap **Configure** next to it, select your primary App ID (`co.katavo.app`), tap **Save**.
> 5. Tap **Continue**, then **Register**.
> 6. **Download the .p8 file immediately** — you can only download it once. Save it somewhere safe (a password manager works).
> 7. Note the **Key ID** (10-character string shown on the success page).

- [ ] **Step 3: Note your Apple Team ID**

Surface to user:
> Your Team ID is in the top-right corner of any Apple Developer page (looks like `ABC1234DE5`). Note it for the Supabase step.

- [ ] **Step 4: Confirm gathering**

Implementer verifies the user has gathered:
- Team ID
- Key ID
- Contents of the .p8 file (a multi-line `-----BEGIN PRIVATE KEY-----` block)

If anything is missing, surface as BLOCKED and re-dispatch when resolved.

---

### Task 2: Google Cloud Console — two OAuth client IDs

**Files:** none (external).

- [ ] **Step 1: Open the Google Cloud Console OAuth credentials page**

Surface to user:
> 1. Go to https://console.cloud.google.com/apis/credentials
> 2. If you don't have a project yet, create one named `Katavo`. Otherwise select your existing project.
> 3. If prompted, configure the OAuth consent screen first: **External**, app name `Katavo`, user support email = your email, developer contact = your email. Save and continue through the scopes screen (defaults are fine), test users (skip), and back to dashboard.

- [ ] **Step 2: Create the iOS OAuth client**

Surface to user:
> 1. **Create Credentials** → **OAuth client ID**.
> 2. **Application type:** iOS.
> 3. **Name:** `Katavo iOS`.
> 4. **Bundle ID:** `co.katavo.app`.
> 5. **Create**.
> 6. Note the **iOS Client ID** (looks like `123456789-abc...apps.googleusercontent.com`).
> 7. Also note the **iOS URL scheme** Google shows you (looks like `com.googleusercontent.apps.123456789-abc...`). This is the reversed client ID we need for app.json.

- [ ] **Step 3: Create the Web OAuth client**

Surface to user:
> 1. **Create Credentials** → **OAuth client ID** again.
> 2. **Application type:** Web application.
> 3. **Name:** `Katavo Web`.
> 4. Leave **Authorized JavaScript origins** and **Authorized redirect URIs** empty for now.
> 5. **Create**.
> 6. Note the **Web Client ID** (`...apps.googleusercontent.com`). The client secret is not needed.

- [ ] **Step 4: Confirm gathering**

Implementer verifies the user has:
- iOS Client ID
- iOS reversed URL scheme
- Web Client ID

---

### Task 3: Supabase Auth dashboard — paste credentials + flip same-email flag

**Files:** none (external).

- [ ] **Step 1: Configure the Apple provider**

Surface to user:
> 1. Go to https://supabase.com/dashboard/project/rkupotxkyeficaanxzrp/auth/providers
> 2. Find **Apple** in the list, tap it, toggle **Enable Sign in with Apple** on.
> 3. Fill in:
>    - **Client IDs (for OAuth)**: leave blank or set to `co.katavo.app`
>    - **Service ID** (for Sign in with Apple Native): `co.katavo.app`
>    - **Team ID**: from Task 1 Step 3
>    - **Key ID**: from Task 1 Step 2
>    - **Secret Key (for OAuth)**: paste the entire contents of the .p8 file (including the BEGIN/END lines and all newlines)
> 4. Save.

- [ ] **Step 2: Configure the Google provider**

Surface to user:
> 1. Same Auth → Providers page, find **Google**, tap, toggle on.
> 2. Fill in:
>    - **Client IDs (for OAuth)**: paste the **Web Client ID** from Task 2 Step 3
>    - **Skip nonce checks**: leave unchecked
>    - **Authorized Client IDs (for native sign-in)**: paste the **Web Client ID** here too
>    - Client Secret: leave blank — not needed for native flow
> 3. Save.

(Yes, both fields take the Web Client ID. The "Authorized Client IDs" field is what Supabase uses to validate the audience claim in tokens issued by the Google iOS native lib, which is configured to use the Web Client ID as audience.)

- [ ] **Step 3: Enable same-email auto-linking**

Surface to user:
> 1. Same dashboard, scroll to find **Allow same email for multiple identities** (under Auth → Settings or Advanced — exact location varies by Supabase version).
> 2. Toggle it **on**. Save.

- [ ] **Step 4: Confirm config**

Verify both providers show **Enabled** in the providers list. If either still shows disabled, surface as BLOCKED.

---

## Chunk 2: Code Installation + Config

### Task 4: Install the two native modules

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [ ] **Step 1: Install both via expo install**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile"
node node_modules/expo/bin/cli install expo-apple-authentication
node node_modules/expo/bin/cli install @react-native-google-signin/google-signin
```

The `.npmrc` in `mobile/` has `legacy-peer-deps=true` so canary peer-dep mismatches don't block.

- [ ] **Step 2: Verify expected major versions**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && grep -E '"expo-apple-authentication"|"@react-native-google-signin' package.json
```

Expected: `expo-apple-authentication` major ≥ 7, `@react-native-google-signin/google-signin` major ≥ 14. If either is on an older major, the spec's idToken-shape fallback may need adjustment — surface as DONE_WITH_CONCERNS.

- [ ] **Step 3: Commit**

Stage ONLY package.json + package-lock.json (working tree may have other unrelated in-flight edits):

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/package.json mobile/package-lock.json && git commit -m "$(cat <<'EOF'
chore(mobile): add expo-apple-authentication + react-native-google-signin

Both are native modules — dev client on the iPhone needs an EAS rebuild
before runtime works.
EOF
)"
```

---

### Task 5: Update app.json (Apple capability + Google URL scheme + plugins)

**Files:**
- Modify: `mobile/app.json`

- [ ] **Step 1: Read current app.json structure**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/app.json"
```

Note: the `expo.ios` block already has a `bundleIdentifier`, `supportsTablet`, `infoPlist`, and `bitcode` field. The `expo.plugins` array has 4 entries today: `expo-router`, `@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`, `expo-audio`.

- [ ] **Step 2: Add `usesAppleSignIn` to expo.ios**

Inside the `expo.ios` object, add a new field:

```json
"usesAppleSignIn": true
```

- [ ] **Step 3: Add Google URL scheme to expo.ios.infoPlist**

Inside `expo.ios.infoPlist`, append a new `CFBundleURLTypes` entry. If the field doesn't exist yet, create it. Replace `<YOUR-IOS-REVERSED-CLIENT-ID>` with the value from Task 2 Step 2:

```json
"CFBundleURLTypes": [
  {
    "CFBundleURLSchemes": [
      "com.googleusercontent.apps.<YOUR-IOS-REVERSED-CLIENT-ID>"
    ]
  }
]
```

If the user's reversed client ID is e.g. `com.googleusercontent.apps.123456789-abc`, the value above is exactly that string (already includes the `com.googleusercontent.apps.` prefix in what Google shows you).

- [ ] **Step 4: Append two plugin entries to expo.plugins**

Append these two strings to the existing plugins array:

```json
"expo-apple-authentication",
"@react-native-google-signin/google-signin"
```

Final plugins array order (preserve existing entries):
1. `expo-router`
2. `@livekit/react-native-expo-plugin`
3. `@config-plugins/react-native-webrtc`
4. `expo-audio`
5. `expo-apple-authentication`
6. `@react-native-google-signin/google-signin`

- [ ] **Step 5: Validate JSON**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && python3 -c "import json; print('OK' if json.load(open('app.json')) else 'BAD')"
```

Expected: `OK`. If the JSON is malformed, the value-based edits in Steps 2-4 introduced a syntax error — re-read and fix.

- [ ] **Step 6: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/app.json && git commit -m "feat(mobile): app.json — Apple Sign In + Google URL scheme + plugins"
```

---

### Task 6: Add Google client IDs to mobile/.env

**Files:**
- Modify: `mobile/.env` (gitignored — local change only)

- [ ] **Step 1: Append to mobile/.env**

```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<value from Task 2 Step 2 — the .apps.googleusercontent.com one>
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<value from Task 2 Step 3 — also .apps.googleusercontent.com>
```

(Both are already-public values — `EXPO_PUBLIC_` env vars are bundled into the app and visible to anyone who reverse-engineers the binary. That's fine for OAuth client IDs by design.)

- [ ] **Step 2: Verify they're set**

```bash
grep -E "^EXPO_PUBLIC_GOOGLE_" "/Users/isuru/personal/AI Podcast App/mobile/.env"
```

Expected: two lines printed.

- [ ] **Step 3: No commit**

`mobile/.env` is gitignored. Nothing to commit for this task.

---

## Chunk 3: Auth Provider Library

### Task 7: Create auth-providers.ts

**Files:**
- Create: `mobile/src/lib/auth-providers.ts`

- [ ] **Step 1: Create the file**

Write `mobile/src/lib/auth-providers.ts` with this exact content:

```ts
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
  // v14 uses userInfo.data.idToken; older majors used userInfo.idToken.
  // Confirm the shape during runtime testing — fallback covers both.
  const idToken =
    userInfo.data?.idToken ??
    (userInfo as { idToken?: string }).idToken;
  if (!idToken) {
    throw new Error("Google sign-in returned no ID token");
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
  return {
    displayName:
      userInfo.data?.user?.name ??
      (userInfo as { user?: { name?: string } }).user?.name ??
      undefined,
  };
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
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/lib/auth-providers.ts && git commit -m "$(cat <<'EOF'
feat(mobile): auth-providers.ts wraps native Apple + Google sign-in

Each wrapper triggers the iOS native sheet, exchanges the identity token
with Supabase via signInWithIdToken, and returns any first-time display
name for the caller to persist into profiles.display_name.

isCancellationError helper distinguishes user-canceled-the-sheet from
real failures so the UI can silence cancellations.
EOF
)"
```

---

### Task 8: Update useAuth.tsx

**Files:**
- Modify: `mobile/src/hooks/useAuth.tsx`

- [ ] **Step 1: Read the current file to find insertion points**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/src/hooks/useAuth.tsx"
```

Note where `AuthContextType` is declared, where the existing `signIn`/`signUp`/`signOut` callbacks are defined, and where the `<AuthContext.Provider value={...}>` is rendered.

- [ ] **Step 2: Update AuthContextType interface**

Find the existing `interface AuthContextType` block. Add two new method signatures alongside the existing `signIn` etc.:

```ts
interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithApple: () => Promise<void>;     // <- new
  signInWithGoogle: () => Promise<void>;    // <- new
}
```

- [ ] **Step 3: Add imports inside the file**

Near the top, alongside the existing `import { supabase }` line, add:

```ts
import {
  signInWithApple as signInWithAppleNative,
  signInWithGoogle as signInWithGoogleNative,
} from "../lib/auth-providers";
```

- [ ] **Step 4: Add the two callbacks inside AuthProvider**

After the existing `signOut` useCallback, add:

```ts
const signInWithApple = useCallback(async () => {
  const { displayName } = await signInWithAppleNative();
  if (displayName) await persistDisplayNameIfMissing(displayName);
}, []);

const signInWithGoogle = useCallback(async () => {
  const { displayName } = await signInWithGoogleNative();
  if (displayName) await persistDisplayNameIfMissing(displayName);
}, []);

async function persistDisplayNameIfMissing(name: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: row } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  if (!row?.display_name) {
    await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", user.id);
  }
}
```

- [ ] **Step 5: Add both to the AuthContext.Provider value prop**

Find the existing `<AuthContext.Provider value={{ session, user, loading, signIn, signUp, signOut }}>` and add the two new methods:

```tsx
<AuthContext.Provider
  value={{
    session,
    user,
    loading,
    signIn,
    signUp,
    signOut,
    signInWithApple,
    signInWithGoogle,
  }}
>
```

- [ ] **Step 6: Type-check**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean exit. If TypeScript flags anything inside `useAuth.tsx`, double-check that the imports line and the persistDisplayNameIfMissing function are well-formed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/hooks/useAuth.tsx && git commit -m "$(cat <<'EOF'
feat(mobile): useAuth exposes signInWithApple + signInWithGoogle

AuthContextType gets the two new method signatures; the Provider value
prop passes them through. persistDisplayNameIfMissing only writes to
profiles.display_name when it's currently null/empty so a returning
Apple user (where Apple no longer sends fullName) doesn't get their
name overwritten by an empty string.
EOF
)"
```

---

## Chunk 4: UI Updates

### Task 9: Create the GoogleButton component

**Files:**
- Create: `mobile/src/components/GoogleButton.tsx`

- [ ] **Step 1: Write the component**

Create `mobile/src/components/GoogleButton.tsx`:

```tsx
/**
 * Google-branded sign-in button. White pill with hairline border, color "G"
 * mark on the left and "Continue with Google" label centered. Matches the
 * project's pill button shape (56pt height, 999 corner radius).
 *
 * The "G" mark is rendered as text inline with brand color — sufficient
 * for v1 and dependency-free. Swap to an SVG when we have a proper
 * brand-asset bundle.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, font } from "../theme/tokens";

interface Props {
  onPress: () => void;
  disabled?: boolean;
}

export function GoogleButton({ onPress, disabled = false }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.row}>
        <Text style={styles.glyph}>G</Text>
        <Text style={styles.label}>Continue with Google</Text>
        <View style={styles.glyphSpacer} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  glyph: {
    fontFamily: font.sansSemiBold,
    fontSize: 22,
    color: "#4285F4", // Google blue
    width: 24,
    textAlign: "center",
  },
  glyphSpacer: { width: 24 },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.ink,
    flex: 1,
    textAlign: "center",
    letterSpacing: -0.1,
  },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add mobile/src/components/GoogleButton.tsx && git commit -m "feat(mobile): GoogleButton component (white pill, Google-blue G mark)"
```

---

### Task 10: Update sign-in.tsx with social buttons

**Files:**
- Modify: `mobile/app/(auth)/sign-in.tsx`

- [ ] **Step 1: Read current sign-in.tsx**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/app/(auth)/sign-in.tsx"
```

The current screen has: eyebrow, title, subtitle, error, fields (email + password), CTA pill (Sign in), switch link.

- [ ] **Step 2: Add imports**

Near the top of the file, alongside the existing imports:

```ts
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleButton } from "../../src/components/GoogleButton";
import { isCancellationError } from "../../src/lib/auth-providers";
```

Update the existing `useAuth` destructure to pull in the social methods:

```ts
const { signIn, signInWithApple, signInWithGoogle } = useAuth();
```

- [ ] **Step 3: Add submitting state + wrapper handlers**

Inside the component, alongside the existing `loading` state, add:

```ts
const [submitting, setSubmitting] = useState<"apple" | "google" | null>(null);

const handleApple = async () => {
  setError(null);
  setSubmitting("apple");
  try {
    await signInWithApple();
  } catch (e: any) {
    if (!isCancellationError(e)) {
      setError(e?.message || "Couldn't sign in with Apple. Try again.");
    }
  } finally {
    setSubmitting(null);
  }
};

const handleGoogle = async () => {
  setError(null);
  setSubmitting("google");
  try {
    await signInWithGoogle();
  } catch (e: any) {
    if (!isCancellationError(e)) {
      setError(e?.message || "Couldn't sign in with Google. Try again.");
    }
  } finally {
    setSubmitting(null);
  }
};
```

- [ ] **Step 4: Render the social buttons + divider above the email form**

Inside the existing `<View style={styles.body}>` block, AFTER the existing eyebrow/title/subtitle/error and BEFORE the `<View style={styles.fields}>` block, insert:

```tsx
<View style={styles.socialButtons}>
  <AppleAuthentication.AppleAuthenticationButton
    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
    cornerRadius={28}
    style={[
      styles.appleButton,
      submitting !== null && { opacity: 0.5 },
    ]}
    onPress={handleApple}
  />
  <GoogleButton onPress={handleGoogle} disabled={submitting !== null} />
</View>

<View style={styles.divider}>
  <View style={styles.dividerLine} />
  <Text style={styles.dividerLabel}>or with email</Text>
  <View style={styles.dividerLine} />
</View>
```

- [ ] **Step 5: Add the new styles**

In the `StyleSheet.create({...})` block, add these entries (place them in a sensible spot, e.g. before `fields`):

```ts
socialButtons: {
  gap: space.sm,
  marginBottom: space.lg,
},
appleButton: {
  height: 56,
  width: "100%",
},
divider: {
  flexDirection: "row",
  alignItems: "center",
  gap: space.sm,
  marginVertical: space.lg,
},
dividerLine: {
  flex: 1,
  height: 1,
  backgroundColor: color.hairline,
},
dividerLabel: {
  ...text.bodySmall,
  color: color.inkTertiary,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontSize: 11,
},
```

- [ ] **Step 6: Disable email Sign in button while social is submitting**

Find the existing `canSubmit` calculation:

```ts
const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;
```

Update to also block while a social submit is in flight:

```ts
const canSubmit =
  email.trim().length > 0 &&
  password.length > 0 &&
  !loading &&
  submitting === null;
```

- [ ] **Step 7: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add 'mobile/app/(auth)/sign-in.tsx' && git commit -m "$(cat <<'EOF'
feat(mobile): sign-in screen — Apple + Google buttons above email form

Apple uses the official AppleAuthenticationButton (HIG-compliant,
auto-styles for light/dark). Google uses the new GoogleButton component.
Both wrapped in handleApple/handleGoogle which manage a submitting state
(buttons + email form disabled during in-flight token exchange) and
silence cancellation errors via isCancellationError helper.
EOF
)"
```

---

### Task 11: Update sign-up.tsx with social buttons

**Files:**
- Modify: `mobile/app/(auth)/sign-up.tsx`

- [ ] **Step 1: Read current sign-up.tsx**

```bash
cat "/Users/isuru/personal/AI Podcast App/mobile/app/(auth)/sign-up.tsx"
```

Note whether the screen has a "Check your email" confirmation state (rendered after a successful submit). The social buttons should ONLY appear on the form state, not on the confirmation state.

- [ ] **Step 2: Mirror the changes from Task 10**

Apply the same pattern — imports, submitting state, handleApple/handleGoogle wrappers, social buttons + divider rendered ABOVE the email form, new styles, canSubmit guard. The only difference vs sign-in.tsx:

a. The `useAuth` destructure pulls in `signUp` (already there) plus `signInWithApple, signInWithGoogle`.
b. The social buttons are wrapped in a guard so they DON'T render on the confirmation state. Find the conditional that renders the form vs the "check your email" state, and put the social buttons inside the form branch only.

If the file looks like:

```tsx
if (sentEmail) {
  return <ConfirmationView ... />;
}

return <FormView ... />;
```

Then the social buttons go inside the FormView return, not the ConfirmationView return.

- [ ] **Step 3: Type-check + commit**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/isuru/personal/AI Podcast App" && git add 'mobile/app/(auth)/sign-up.tsx' && git commit -m "$(cat <<'EOF'
feat(mobile): sign-up screen — Apple + Google buttons on form state

Mirrors sign-in.tsx — same handleApple/handleGoogle wrappers, same
divider, same socialButtons style. Social buttons only render on the
form state; the post-submit "check your email" confirmation state
remains buttons-free (OAuth doesn't need email confirmation since the
provider already verified the email).
EOF
)"
```

---

## Chunk 5: Build + Validate

### Task 12: EAS dev build

**Files:** none changed.

- [ ] **Step 1: Trigger the EAS dev build**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && eas build --profile development --platform ios --non-interactive --no-wait 2>&1 | tail -8
```

Note the build URL printed. Expected: `Compressing project files...` followed by a `https://expo.dev/accounts/.../builds/<id>` URL.

- [ ] **Step 2: Watch for completion**

Use a Monitor task or check periodically:

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile" && eas build:view <build-id> 2>&1 | grep -E "Status|Application Archive"
```

Expected: Status finishes (15-25 min for a fresh native build). On error, surface as BLOCKED with the URL — likely cause is a peer-dep issue with one of the two new packages on canary SDK 55. The .npmrc legacy-peer-deps usually handles it but isn't bulletproof on EAS's clean builds.

- [ ] **Step 3: Install on device**

User-side: open the Application Archive URL on the iPhone, install over the existing dev client (same bundle id `co.katavo.app`).

---

### Task 13: Validate — Apple sign-in

**Files:** none changed. Manual e2e on device.

Pre-conditions: dev client installed, Metro running (`npx expo start --dev-client --tunnel` or `--lan` from inside hotspot).

- [ ] **Step 1: Reset to a fresh user state**

```bash
cd "/Users/isuru/personal/AI Podcast App/pipeline" && npm run reset-user -- 4ca754e5-fdef-4b75-837a-c6125fbf5279 --tier=free
```

Then sign out from the app if you're signed in (Account → Sign out).

- [ ] **Step 2: Tap Continue with Apple**

Open the app → sign-in screen → tap **Continue with Apple**. Expected:
- Native iOS bottom sheet appears
- Choose to share or hide email
- FaceID/Touch ID confirms
- App lands in `/(onboarding)/welcome` (since voice is null after reset)

- [ ] **Step 3: Verify DB state**

```sql
SELECT u.id, u.email, p.display_name, p.preferred_voice
FROM auth.users u JOIN public.profiles p ON p.id = u.id
WHERE u.id = '4ca754e5-fdef-4b75-837a-c6125fbf5279';
```

Run via `mcp__supabase__execute_sql`. Expected: `display_name` is populated (your full name from Apple), `preferred_voice` is NULL.

- [ ] **Step 4: Verify second Apple sign-in doesn't overwrite name**

Sign out, sign back in with Apple. Apple this time returns no fullName (privacy model). Re-query DB — `display_name` should still be the value from Step 3 (not blanked).

---

### Task 14: Validate — Google sign-in

**Files:** none changed. Manual e2e.

- [ ] **Step 1: Reset + sign out**

Same as Task 13 Step 1.

- [ ] **Step 2: Tap Continue with Google**

Open app → sign-in → tap **Continue with Google**. Expected:
- Native Google account picker bottom sheet
- Pick the test account
- App lands in `/(onboarding)/welcome`

- [ ] **Step 3: Verify DB state**

```sql
SELECT id, display_name FROM public.profiles WHERE id = '<your user id>';
```

Expected: `display_name` is your Google account's name.

---

### Task 15: Validate — auto-linking

**Files:** none changed. Manual e2e.

Pre-condition: the "Allow same email for multiple identities" flag is on in Supabase Auth (Task 3 Step 3). If not, this test will fail with `User already registered`.

- [ ] **Step 1: Reset + sign out**

- [ ] **Step 2: Sign up with email/password**

Sign-up flow → use an email you also have a Google account for (e.g. your Gmail). Pick a password.

- [ ] **Step 3: Sign out**

- [ ] **Step 4: Tap Continue with Google with the same Gmail**

Should land in the same account.

- [ ] **Step 5: Verify single user record**

```sql
SELECT u.id, u.email, count(i.id) as identity_count
FROM auth.users u LEFT JOIN auth.identities i ON i.user_id = u.id
WHERE u.email = '<your gmail>'
GROUP BY u.id, u.email;
```

Expected: one user row, `identity_count = 2` (one email identity, one google identity, same user_id).

---

### Task 16: Validate — email/password still works

**Files:** none changed. Manual e2e.

- [ ] **Step 1: Reset + sign out**

- [ ] **Step 2: Sign in with the email/password account from Task 15 Step 2**

Should sign in normally, land in `/(tabs)` or `/(onboarding)/welcome` per the gate.

- [ ] **Step 3: Sign out, verify state cleared**

- [ ] **Step 4: Sign in with Apple again**

Should still work. Confirms no provider has broken any other.

---

## Open follow-ups (deliberately not in this plan)

- **Connected accounts UI** — let a user link Apple to an existing Google-only account from Account settings. Different feature; needs new screen.
- **Avatar capture** — both providers return profile picture URLs. Capture when we add a profile screen.
- **Additional providers** (GitHub, Microsoft, Facebook).
- **Magic link / passwordless email** — out of scope; email/password stays as-is.
- **Password reset UI** — Supabase supports it server-side; we don't have UI.
- **Web sign-in** — app is iOS-only.
