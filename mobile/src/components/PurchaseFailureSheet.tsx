/**
 * PurchaseFailureSheet — paper-light bottom sheet shown when any
 * RevenueCat purchase (tier switch or extra credit) fails. Shared
 * vocabulary with SwitchTierSheet (grab pill, eyebrow, editorial title,
 * body paragraph, primary CTA, secondary text-link). The eyebrow uses
 * Brick Ink rather than accent — failure register, never alarmist red.
 *
 * Each call site sets the `eyebrow` for its own context ("Couldn't
 * switch" for /plans, "Couldn't buy" for credit purchases).
 *
 * Renders nothing for "silent" classifier kinds (cancelled, alreadyOwned)
 * — those are handled by the parent without surfacing UI.
 */
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SwitchFailure } from "../lib/switchErrors";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  failure: SwitchFailure | null;
  /** Eyebrow copy specific to the calling flow. */
  eyebrow: string;
  onRetry: () => void;
  onSecondary: () => void;
  onDismiss: () => void;
}

export function PurchaseFailureSheet({
  visible,
  failure,
  eyebrow,
  onRetry,
  onSecondary,
  onDismiss,
}: Props) {
  if (!failure) return null;

  // Silent kinds shouldn't render. Defensive — the caller usually filters
  // these out before opening the sheet.
  if (failure.kind === "cancelled" || failure.kind === "alreadyOwned") {
    return null;
  }

  const secondaryLabel =
    failure.secondary === "openSettings"
      ? "Open Settings"
      : failure.secondary === "support"
        ? "Contact support"
        : "Close";

  const handleSecondary = () => {
    if (failure.secondary === "close") {
      onDismiss();
      return;
    }
    onSecondary();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={onDismiss} />
        <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>

          <View style={styles.body}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{failure.title}</Text>
            <Text style={styles.paragraph}>{failure.body}</Text>
          </View>

          <View style={styles.footer}>
            {failure.retryable && (
              <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={({ pressed }) => [
                  styles.cta,
                  pressed && styles.ctaPressed,
                ]}
              >
                <Text style={styles.ctaLabel}>Try again</Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleSecondary}
              hitSlop={layout.hitSlop}
              accessibilityRole="button"
              accessibilityLabel={secondaryLabel}
            >
              <Text style={styles.secondary}>{secondaryLabel}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(26, 27, 31, 0.45)",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
  },
  grabRow: {
    alignItems: "center",
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairlineStrong,
  },
  body: {
    paddingTop: space.base,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.warning,
    marginBottom: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 28,
    lineHeight: 34,
  },
  paragraph: {
    ...text.body,
    color: color.inkSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: space.xs,
  },
  footer: {
    paddingTop: space.sm,
    paddingBottom: space.base,
    gap: space.md,
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
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
  secondary: {
    ...text.bodySmall,
    color: color.inkSecondary,
    paddingVertical: space.sm,
  },
});
