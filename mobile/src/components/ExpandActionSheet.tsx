/**
 * ExpandActionSheet — bottom sheet shown when the user taps Expand on a
 * chapter marker.
 *
 * Paper-light editorial register. Paid users see a single accent pill
 * CTA. Free users see two NavRow-style options separated by a hairline:
 * "Buy one credit" and "Upgrade to Plus". The Plus option gets accent
 * subtitle copy so the recommended path reads louder without resorting
 * to a card or filled background.
 *
 * Errors from the in-app expansion submit run through classifySwitchError
 * and surface via the parent's PurchaseFailureSheet — the sheet itself
 * never renders an inline error. Cancellations stay silent.
 *
 * The parent player owns the post-submit celebration sheet
 * (ExpansionQueuedSheet) so success copy lives outside this component.
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
import { useExpansionSubmit } from "../hooks/useExpansionSubmit";
import { classifySwitchError } from "../lib/switchErrors";
import type { SwitchFailure } from "../lib/switchErrors";
import { TIERS, getDeltaCopy } from "../lib/tiers";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  parentPodcastId: string;
  sourceChapterTitle: string;
  onClose: () => void;
  onSubmitted: (podcastId: string, alreadyExisted: boolean) => void;
  /**
   * Route a classified failure up to the parent so it can surface a
   * shared PurchaseFailureSheet (eyebrow "Couldn't expand"). The sheet
   * itself never renders an inline error.
   */
  onError: (failure: SwitchFailure) => void;
  /**
   * Push to /plans. Routed via parent so the player can do its own
   * navigation cleanup (close this sheet first, then navigate).
   */
  onUpgrade: () => void;
}

export function ExpandActionSheet({
  visible,
  parentPodcastId,
  sourceChapterTitle,
  onClose,
  onSubmitted,
  onError,
  onUpgrade,
}: Props) {
  const { subscription } = useSubscription();
  const tier = subscription?.tier ?? "free";
  const isFree = tier === "free";
  const creditPrice = TIERS[tier].extraCreditPrice;
  const plusSubtitle = `${TIERS.plus.priceLabel} · ${getDeltaCopy("free", "plus")}`;

  const { submit, submitting } = useExpansionSubmit();
  const [showBuyCredit, setShowBuyCredit] = useState(false);

  const runSubmit = async () => {
    try {
      const { podcastId, alreadyExisted } = await submit(
        parentPodcastId,
        sourceChapterTitle,
      );
      onClose();
      onSubmitted(podcastId, alreadyExisted);
    } catch (err) {
      const classified = classifySwitchError(err);
      if (classified.kind === "cancelled") return;
      onClose();
      onError(classified);
    }
  };

  const handleBuyCreditDone = async () => {
    setShowBuyCredit(false);
    await runSubmit();
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
              <Text style={styles.eyebrow}>Expand this chapter</Text>
              <Text style={styles.title} numberOfLines={3}>
                {sourceChapterTitle}
              </Text>

              {isFree ? (
                <>
                  <Text style={styles.subtitle}>Two ways to keep going.</Text>

                  <View style={styles.optionDivider} />
                  <OptionRow
                    title="Buy one credit"
                    subtitle={`$${creditPrice} · use for this expansion`}
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
                </>
              ) : (
                <>
                  <Text style={styles.subtitle}>
                    Uses 1 credit · ~10 min to generate.
                  </Text>
                  <Pressable
                    onPress={runSubmit}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel="Expand chapter"
                    accessibilityState={{ disabled: submitting }}
                    style={({ pressed }) => [
                      styles.cta,
                      submitting && styles.ctaDisabled,
                      pressed && !submitting && styles.ctaPressed,
                    ]}
                  >
                    <Text style={styles.ctaLabel}>
                      {submitting ? "Submitting" : "Expand chapter"}
                    </Text>
                  </Pressable>
                </>
              )}

              <Pressable
                onPress={onClose}
                hitSlop={layout.hitSlop}
                style={styles.cancelRow}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancel}>
                  {isFree ? "Maybe later" : "Cancel"}
                </Text>
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
  cta: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
    marginTop: space.sm,
  },
  ctaDisabled: { backgroundColor: color.hairlineStrong },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
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
