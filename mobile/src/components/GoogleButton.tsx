/**
 * Google-branded sign-in button. White pill with hairline border, color "G"
 * mark and "Continue with Google" label centered as a group — same visual
 * cadence as the Apple button native control sitting next to it.
 *
 * Uses system font (San Francisco on iOS, Roboto on Android) instead of
 * Plex so it reads as a sibling of the AppleAuthenticationButton, which
 * we can't reskin. The rest of the app keeps Plex; this is a deliberate
 * exception for the social-auth section.
 *
 * The "G" mark is rendered as text inline with brand color — sufficient
 * for v1 and dependency-free. Swap to an SVG when we have a proper
 * brand-asset bundle.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme/tokens";

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
        <Text style={styles.label}>Sign in with Google</Text>
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
    alignItems: "center",
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  glyph: {
    // System font to match the Apple-native button next to it.
    fontSize: 20,
    fontWeight: "700",
    color: "#4285F4",
  },
  label: {
    fontSize: 19,
    fontWeight: "600",
    color: color.ink,
    letterSpacing: -0.4,
  },
});
