/**
 * SwitchTierSheet — confirmation surface before any tier change.
 *
 * Same paper-light vocabulary as ResearchingSheet (grab pill, eyebrow,
 * editorial title, two short body paragraphs, accent CTA, smoke cancel).
 *
 * The sheet is a thin renderer; all direction-aware copy and the action
 * type (in-app purchase vs system subscription handoff) come from
 * getSwitchPlan() in lib/tiers.ts.
 */
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SwitchPlan } from "../lib/tiers";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  plan: SwitchPlan | null;
  loading: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function SwitchTierSheet({
  visible,
  plan,
  loading,
  onConfirm,
  onDismiss,
}: Props) {
  if (!plan) return null;

  const eyebrow =
    plan.direction === "upgrade"
      ? "Upgrading"
      : plan.to === "free"
        ? "Cancelling"
        : "Downgrading";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={loading ? undefined : onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.scrim}
          onPress={loading ? undefined : onDismiss}
        />
        <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>

          <View style={styles.body}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{plan.title}</Text>

            {plan.delta.length > 0 && (
              <Text style={styles.paragraph}>{plan.delta}</Text>
            )}
            {plan.billing.length > 0 && (
              <Text style={styles.paragraph}>{plan.billing}</Text>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={onConfirm}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={plan.ctaLabel}
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => [
                styles.cta,
                loading && styles.ctaDisabled,
                pressed && !loading && styles.ctaPressed,
              ]}
            >
              <Text style={styles.ctaLabel}>{plan.ctaLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              disabled={loading}
              hitSlop={layout.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancel}>Cancel</Text>
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
    gap: space.md,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
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
  cancel: {
    ...text.bodySmall,
    color: color.inkSecondary,
    paddingVertical: space.sm,
  },
});
