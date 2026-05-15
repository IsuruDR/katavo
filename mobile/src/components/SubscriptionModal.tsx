// mobile/src/components/SubscriptionModal.tsx
/**
 * Buy-extra-credit bottom sheet.
 *
 * Paper-light sheet sliding up from below. Editorial price block, single
 * accent CTA, quiet text-link cancel. Tier-aware pricing comes from the
 * caller; we only display.
 *
 * Failure handling is delegated upward — the parent owns the
 * PurchaseFailureSheet. We classify the RevenueCat error here, swallow
 * cancellations silently, and call onError(classified) for everything
 * else so the parent can surface a paper-light retry sheet.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { purchaseCredit } from "../services/revenucat";
import { classifySwitchError } from "../lib/switchErrors";
import type { SwitchFailure } from "../lib/switchErrors";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  tier: "free" | "plus" | "pro";
  onClose: () => void;
  onPurchased: () => void;
  onError: (failure: SwitchFailure) => void;
}

const PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

export function SubscriptionModal({
  visible,
  tier,
  onClose,
  onPurchased,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);
  const price = PRICES[tier];

  const handleBuy = async () => {
    setLoading(true);
    try {
      await purchaseCredit(tier);
      onPurchased();
      onClose();
    } catch (err: unknown) {
      const classified = classifySwitchError(err);
      if (classified.kind === "cancelled") {
        // User backed out of the system payment dialog — keep the modal
        // open so they can decide again or dismiss themselves.
        return;
      }
      onClose();
      onError(classified);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={loading ? undefined : onClose} />
        <SafeAreaView
          style={styles.sheet}
          edges={["left", "right", "bottom"]}
        >
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>

          <View style={styles.body}>
            <Text style={styles.eyebrow}>Buy extra credit</Text>
            <Text style={styles.title}>One more podcast</Text>
            <Text style={styles.subtitle}>
              Adds a single credit to your account. Use it any time.
            </Text>

            <View style={styles.priceBlock}>
              <Text style={styles.price}>${price}</Text>
              <Text style={styles.priceMeta}>per credit</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={handleBuy}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={`Buy one credit for ${price} dollars`}
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => [
                styles.cta,
                loading && styles.ctaDisabled,
                pressed && !loading && styles.ctaPressed,
              ]}
            >
              <Text style={styles.ctaLabel}>Buy for ${price}</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
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
    gap: space.xs,
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
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  priceBlock: {
    paddingTop: space.lg,
    alignItems: "flex-start",
  },
  price: {
    fontFamily: font.serifBold,
    fontSize: 56,
    lineHeight: 60,
    color: color.ink,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
  },
  priceMeta: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  footer: {
    paddingTop: space.base,
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
