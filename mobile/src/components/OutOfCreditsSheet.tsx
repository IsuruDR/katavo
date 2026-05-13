/**
 * OutOfCreditsSheet — bottom sheet shown when a retry attempt fails
 * because the user has no credits. Mirrors ExpandActionSheet's free-user
 * variant: paper-light editorial register, two NavRow-style options
 * separated by hairlines, with Plus subtitle in accent for the
 * recommended path.
 *
 * Options:
 *   - "Buy one credit"   ($X · retry this podcast)   → SubscriptionModal
 *   - "Upgrade to Plus"  ($14.99/mo · ...)           → /plans
 *
 * On successful credit purchase, calls onPurchased so the parent can
 * re-trigger the original retry. Errors classified and routed to the
 * parent for shared PurchaseFailureSheet handling.
 */
import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { SubscriptionModal } from "./SubscriptionModal";
import { useSubscription } from "../hooks/useSubscription";
import type { SwitchFailure } from "../lib/switchErrors";
import { TIERS, getDeltaCopy } from "../lib/tiers";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  topic: string;
  onClose: () => void;
  onPurchased: () => Promise<void> | void;
  onUpgrade: () => void;
  onError: (failure: SwitchFailure) => void;
}

export function OutOfCreditsSheet({
  visible,
  topic,
  onClose,
  onPurchased,
  onUpgrade,
  onError,
}: Props) {
  const { subscription } = useSubscription();
  const tier = subscription?.tier ?? "free";
  const creditPrice = TIERS[tier].extraCreditPrice;
  const plusSubtitle = `${TIERS.plus.priceLabel} · ${getDeltaCopy("free", "plus")}`;

  const [showBuyCredit, setShowBuyCredit] = useState(false);

  const handleBuyCreditDone = async () => {
    setShowBuyCredit(false);
    onClose();
    await onPurchased();
  };

  const handleUpgrade = () => {
    onClose();
    onUpgrade();
  };

  return (
    <>
      <Modal
        visible={visible && !showBuyCredit}
        animationType="slide"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <Pressable style={styles.scrim} onPress={onClose} />
          <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
            <View style={styles.grabRow}>
              <View style={styles.grab} />
            </View>

            <View style={styles.body}>
              <Text style={styles.eyebrow}>Out of credits</Text>
              <Text style={styles.title} numberOfLines={3}>
                {topic}
              </Text>

              <Text style={styles.subtitle}>Two ways to keep going.</Text>

              <View style={styles.optionDivider} />
              <OptionRow
                title="Buy one credit"
                subtitle={`$${creditPrice} · retry this podcast`}
                onPress={() => setShowBuyCredit(true)}
              />
              <View style={styles.optionDivider} />
              <OptionRow
                title={`Upgrade to ${TIERS.plus.name}`}
                subtitle={plusSubtitle}
                subtitleAccent
                onPress={handleUpgrade}
              />
              <View style={styles.optionDivider} />

              <Pressable
                onPress={onClose}
                hitSlop={layout.hitSlop}
                style={styles.cancelRow}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancel}>Maybe later</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <SubscriptionModal
        visible={showBuyCredit}
        tier={tier}
        onClose={() => setShowBuyCredit(false)}
        onPurchased={handleBuyCreditDone}
        onError={(failure) => {
          setShowBuyCredit(false);
          onClose();
          onError(failure);
        }}
      />
    </>
  );
}

interface OptionRowProps {
  title: string;
  subtitle: string;
  subtitleAccent?: boolean;
  onPress: () => void;
}

function OptionRow({
  title,
  subtitle,
  subtitleAccent = false,
  onPress,
}: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
    >
      <View style={styles.optionBody}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text
          style={
            subtitleAccent
              ? styles.optionSubtitleAccent
              : styles.optionSubtitle
          }
        >
          {subtitle}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={color.inkSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(26, 27, 31, 0.45)",
  },
  scrim: { ...StyleSheet.absoluteFillObject },
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
    paddingBottom: space.lg,
    gap: space.sm,
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
  optionDivider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  optionPressed: {
    opacity: 0.55,
  },
  optionBody: {
    flex: 1,
    gap: space.xxs,
  },
  optionTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  optionSubtitle: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  optionSubtitleAccent: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.accent,
    marginTop: space.xs,
  },
  cancelRow: {
    alignItems: "center",
    paddingTop: space.md,
  },
  cancel: {
    ...text.bodySmall,
    color: color.inkSecondary,
    paddingVertical: space.sm,
  },
});
