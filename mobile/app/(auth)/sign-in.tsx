/**
 * Sign-in — paper-light editorial form.
 *
 * Eyebrow brand mark up top, display-serif welcome line, two
 * bottom-hairline-only inputs, anchored Sign-in pill at the bottom with
 * the cross-link to Sign-up below it. Errors render inline; no alerts.
 */
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "../../src/hooks/useAuth";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { GoogleButton } from "../../src/components/GoogleButton";
import { isCancellationError } from "../../src/lib/auth-providers";
import { color, font, layout, space, text } from "../../src/theme/tokens";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn, signInWithApple, signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState<"apple" | "google" | null>(null);

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    !loading &&
    submitting === null;

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

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      setError(err?.message || "Couldn't sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingOverlay message="Signing in" />;

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Katavo</Text>
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>Sign in to keep listening.</Text>

          {error && <Text style={styles.error}>{error}</Text>}

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
            <GoogleButton
              onPress={handleGoogle}
              disabled={submitting !== null}
            />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>or with email</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.fields}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={color.inkTertiary}
              value={email}
              onChangeText={(v) => {
                if (error) setError(null);
                setEmail(v);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              accessibilityLabel="Email"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={color.inkTertiary}
              value={password}
              onChangeText={(v) => {
                if (error) setError(null);
                setPassword(v);
              }}
              secureTextEntry
              autoComplete="password"
              accessibilityLabel="Password"
            />
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSignIn}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.cta,
              !canSubmit && styles.ctaDisabled,
              pressed && canSubmit && styles.ctaPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.ctaLabel}>Sign in</Text>
          </Pressable>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable hitSlop={layout.hitSlop}>
              <Text style={styles.switchLink}>
                New here?{" "}
                <Text style={styles.switchLinkAccent}>Create an account</Text>
              </Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  flex: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    gap: space.sm,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space.md,
  },
  title: {
    ...text.displaySerif,
    fontSize: 36,
    lineHeight: 42,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    fontFamily: font.serifRegular,
    fontSize: 17,
    lineHeight: 24,
    marginBottom: space.xxl,
  },
  error: {
    ...text.bodySmall,
    color: color.warning,
    marginBottom: space.sm,
  },
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
  fields: {
    gap: space.lg,
  },
  input: {
    fontFamily: font.sansMedium,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineStrong,
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.base,
    paddingBottom: space.lg,
    gap: space.lg,
    alignItems: "center",
  },
  cta: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaDisabled: {
    backgroundColor: color.hairlineStrong,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
  switchLink: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  switchLinkAccent: {
    color: color.accent,
    fontFamily: font.sansSemiBold,
  },
});
