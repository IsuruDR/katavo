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
    color: "#4285F4",
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
