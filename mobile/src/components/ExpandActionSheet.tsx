/**
 * Bottom sheet shown when user taps Expand on a chapter marker.
 *
 * Paid users (plus/pro): single Expand CTA → calls useExpansionSubmit.
 * Free users: two-path UI — buy one credit ($5) via SubscriptionModal,
 *             or upgrade to Plus via router.push("/plans").
 *
 * After a successful submission the parent player handles navigation
 * (alreadyExisted=true → push to existing podcast; alreadyExisted=false →
 * stay on parent, let ChapterMarkers' realtime subscription flip the
 * affordance as generation progresses).
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
import { useRouter } from "expo-router";
import { SubscriptionModal } from "./SubscriptionModal";
import { useSubscription } from "../hooks/useSubscription";
import { useExpansionSubmit } from "../hooks/useExpansionSubmit";
import { color, font, layout, space, text } from "../theme/tokens";

interface Props {
  visible: boolean;
  parentPodcastId: string;
  sourceChapterTitle: string;
  onClose: () => void;
  onSubmitted: (podcastId: string, alreadyExisted: boolean) => void;
}

export function ExpandActionSheet({
  visible,
  parentPodcastId,
  sourceChapterTitle,
  onClose,
  onSubmitted,
}: Props) {
  const router = useRouter();
  const { subscription } = useSubscription();
  const isFree = subscription?.tier === "free";
  const { submit, submitting, error } = useExpansionSubmit();
  const [showBuyCredit, setShowBuyCredit] = useState(false);

  const handleExpand = async () => {
    try {
      const { podcastId, alreadyExisted } = await submit(parentPodcastId, sourceChapterTitle);
      onSubmitted(podcastId, alreadyExisted);
      onClose();
    } catch {
      // Error surfaced via `error` state for inline display
    }
  };

  const handleBuyCreditDone = async () => {
    setShowBuyCredit(false);
    await handleExpand();
  };

  const handleUpgrade = () => {
    onClose();
    router.push("/plans");
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Pressable style={styles.scrim} onPress={onClose} />
          <SafeAreaView style={styles.sheet} edges={["left", "right", "bottom"]}>
            <View style={styles.grabRow}>
              <View style={styles.grab} />
            </View>

            <View style={styles.body}>
              <Text style={styles.eyebrow}>Expand this chapter</Text>
              <Text style={styles.title}>{sourceChapterTitle}</Text>

              {error && <Text style={styles.error}>{error}</Text>}

              {isFree ? (
                <>
                  <Text style={styles.subtitle}>Two ways to keep going:</Text>
                  <View style={styles.optionsStack}>
                    <Pressable
                      onPress={() => setShowBuyCredit(true)}
                      style={({ pressed }) => [styles.optionOutline, pressed && styles.optionPressed]}
                    >
                      <Text style={styles.optionTitle}>Buy one credit ($5)</Text>
                      <Text style={styles.optionMeta}>Use for this episode</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleUpgrade}
                      style={({ pressed }) => [styles.optionFilled, pressed && styles.optionPressed]}
                    >
                      <Text style={styles.optionTitleFilled}>Upgrade to Plus</Text>
                      <Text style={styles.optionMetaFilled}>
                        $14.99/mo · 8 credits, no ads, expansions included
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.subtitle}>Uses 1 credit · ~10 min to generate</Text>
                  <Pressable
                    onPress={handleExpand}
                    disabled={submitting}
                    style={({ pressed }) => [
                      styles.cta,
                      submitting && styles.ctaDisabled,
                      pressed && !submitting && styles.ctaPressed,
                    ]}
                  >
                    <Text style={styles.ctaLabel}>
                      {submitting ? "Submitting…" : "Expand chapter"}
                    </Text>
                  </Pressable>
                </>
              )}

              <Pressable
                onPress={onClose}
                hitSlop={layout.hitSlop}
                style={styles.cancelRow}
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
        tier={subscription?.tier ?? "free"}
        onClose={() => setShowBuyCredit(false)}
        onPurchased={handleBuyCreditDone}
        onError={(failure) => {
          console.warn("[ExpandActionSheet] credit purchase failed:", failure);
          setShowBuyCredit(false);
        }}
      />
    </>
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
    marginBottom: space.md,
  },
  error: {
    ...text.bodySmall,
    color: color.warning,
    marginVertical: space.sm,
  },
  optionsStack: {
    gap: space.md,
  },
  optionOutline: {
    borderWidth: 1,
    borderColor: color.accent,
    borderRadius: 16,
    padding: space.lg,
    gap: space.xs,
  },
  optionFilled: {
    backgroundColor: color.accent,
    borderRadius: 16,
    padding: space.lg,
    gap: space.xs,
  },
  optionPressed: { opacity: 0.85 },
  optionTitle: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.accent,
  },
  optionTitleFilled: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.paper,
  },
  optionMeta: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  optionMetaFilled: {
    ...text.bodySmall,
    color: color.paper,
    opacity: 0.85,
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
