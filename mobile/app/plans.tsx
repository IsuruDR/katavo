/**
 * /plans — tier picker. Vertical stacked tier blocks separated by Tea
 * Stain hairlines, current-plan eyebrow on the active tier, per-tier
 * filled (upgrade) or outline (downgrade) CTAs.
 *
 * Optimistic tier pattern:
 *   RevenueCat resolves a successful purchase immediately on the client,
 *   but our Supabase row only updates after RC's webhook fires (often
 *   100ms-several seconds). To avoid the "celebration says Pro, page
 *   still says Plus is current" bug, we track an `optimisticTier` locally
 *   the moment the purchase resolves, render against it, and clear it
 *   when the next refresh confirms the DB has caught up.
 *
 * Failure handling:
 *   classifySwitchError() turns RevenueCat error codes into editorial
 *   copy. Cancellations stay silent. PRODUCT_ALREADY_PURCHASED triggers
 *   a forced refresh + silent celebration recovery for the
 *   already-owned race. Everything else surfaces a PurchaseFailureSheet.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LoadingOverlay } from "../src/components/LoadingOverlay";
import { SwitchTierSheet } from "../src/components/SwitchTierSheet";
import { PurchaseFailureSheet } from "../src/components/PurchaseFailureSheet";
import { UpgradedSheet } from "../src/components/UpgradedSheet";
import { useSubscription } from "../src/hooks/useSubscription";
import { purchaseTier } from "../src/services/revenucat";
import {
  TIERS,
  getDirection,
  getDisplayOrder,
  getStoreSubscriptionUrl,
  getSwitchPlan,
} from "../src/lib/tiers";
import type { SwitchPlan, Tier } from "../src/lib/tiers";
import {
  LinkingFailedError,
  classifySwitchError,
} from "../src/lib/switchErrors";
import type { SwitchFailure } from "../src/lib/switchErrors";
import { color, font, layout, space, text } from "../src/theme/tokens";

/**
 * Contextual title swap. When the screen receives `?context=<feature>`
 * (e.g. from the Research NavRow on free tier), the title contextualises
 * to the feature being upgraded toward. Keeps the rest of the page
 * generic; only the title line changes.
 */
const CONTEXT_TITLES: Record<string, string> = {
  research: "Upgrade to see the Research",
};

export default function Plans() {
  const router = useRouter();
  const { context } = useLocalSearchParams<{ context?: string }>();
  const titleText =
    (context && CONTEXT_TITLES[context]) ?? "Pick your shelf.";
  const { subscription, loading, refresh } = useSubscription();
  const serverTier: Tier = subscription?.tier ?? "free";
  const renewalDate = subscription?.renewalDate ?? null;

  const [optimisticTier, setOptimisticTier] = useState<Tier | null>(null);
  const [pendingPlan, setPendingPlan] = useState<SwitchPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [celebration, setCelebration] = useState<SwitchPlan | null>(null);
  const [failure, setFailure] = useState<SwitchFailure | null>(null);

  const currentTier: Tier = optimisticTier ?? serverTier;

  // Drop the optimistic override once the server side catches up. If the
  // webhook is delayed, the override stays in place and the UI keeps
  // showing the new tier — that matches what the user just paid for.
  useEffect(() => {
    if (optimisticTier && serverTier === optimisticTier) {
      setOptimisticTier(null);
    }
  }, [optimisticTier, serverTier]);

  const handleTierPress = (target: Tier) => {
    if (target === currentTier) return;
    setPendingPlan(getSwitchPlan(currentTier, target, renewalDate));
  };

  const runPurchase = async (plan: SwitchPlan): Promise<void> => {
    const productId = TIERS[plan.to].productId;
    if (!productId) return;

    setWorking(true);
    try {
      await purchaseTier(productId);
      // Source of truth for "they paid": RevenueCat said yes. Snap the
      // local tier to the target, celebrate now, and let refresh catch up
      // in the background.
      setOptimisticTier(plan.to);
      setPendingPlan(null);
      setCelebration(plan);
      void refresh();
    } catch (err: unknown) {
      const classified = classifySwitchError(err);

      if (classified.kind === "cancelled") {
        // Silent — keep the SwitchTierSheet open so the user can decide
        // again or dismiss it themselves.
        return;
      }

      if (classified.kind === "alreadyOwned") {
        // The purchase claims they already own this tier. Refresh and
        // verify; if true, recover with a celebration. If not, fall
        // through to the generic failure surface.
        await refresh();
        setOptimisticTier(plan.to);
        setPendingPlan(null);
        setCelebration(plan);
        return;
      }

      setFailure(classified);
    } finally {
      setWorking(false);
    }
  };

  const runOpenStore = async (): Promise<void> => {
    const url = getStoreSubscriptionUrl();
    try {
      await Linking.openURL(url);
      setPendingPlan(null);
    } catch {
      setFailure(classifySwitchError(new LinkingFailedError()));
    }
  };

  const handleConfirm = () => {
    if (!pendingPlan || working) return;

    if (pendingPlan.action === "openStore") {
      void runOpenStore();
      return;
    }
    if (pendingPlan.action === "purchase") {
      void runPurchase(pendingPlan);
      return;
    }
    setPendingPlan(null);
  };

  const handleFailureRetry = () => {
    if (!pendingPlan) {
      setFailure(null);
      return;
    }
    setFailure(null);
    if (pendingPlan.action === "openStore") {
      void runOpenStore();
    } else if (pendingPlan.action === "purchase") {
      void runPurchase(pendingPlan);
    }
  };

  const handleFailureSecondary = () => {
    if (failure?.secondary === "openSettings") {
      void Linking.openURL(getStoreSubscriptionUrl());
    }
    setFailure(null);
    setPendingPlan(null);
  };

  const handleFailureDismiss = () => {
    setFailure(null);
    setPendingPlan(null);
  };

  const tierBlocks = useMemo(
    () =>
      getDisplayOrder(currentTier).map((tier) => ({
        info: TIERS[tier],
        direction: getDirection(currentTier, tier),
        isCurrent: tier === currentTier,
      })),
    [currentTier],
  );

  if (loading) return <LoadingOverlay message="Loading plans" />;

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.back}>Back</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>Plans</Text>
          <Text style={styles.title}>{titleText}</Text>
          <Text style={styles.subtitle}>Switch any time.</Text>
        </View>

        {tierBlocks.map(({ info, direction, isCurrent }, i) => (
          <View key={info.id}>
            {i > 0 && <View style={styles.divider} />}
            <TierBlock
              info={info}
              direction={direction}
              isCurrent={isCurrent}
              renewalDate={renewalDate}
              onPress={() => handleTierPress(info.id)}
            />
          </View>
        ))}

      </ScrollView>

      <SwitchTierSheet
        visible={pendingPlan !== null && failure === null}
        plan={pendingPlan}
        loading={working}
        onConfirm={handleConfirm}
        onDismiss={() => {
          if (!working) setPendingPlan(null);
        }}
      />

      <UpgradedSheet
        visible={celebration !== null}
        fromTier={celebration?.from ?? "free"}
        toTier={celebration?.to ?? "plus"}
        direction={celebration?.direction ?? "upgrade"}
        renewalDate={renewalDate}
        onDismiss={() => {
          setCelebration(null);
          router.replace("/(tabs)");
        }}
      />

      <PurchaseFailureSheet
        visible={failure !== null}
        failure={failure}
        eyebrow="Couldn't switch"
        onRetry={handleFailureRetry}
        onSecondary={handleFailureSecondary}
        onDismiss={handleFailureDismiss}
      />
    </SafeAreaView>
  );
}

interface TierBlockProps {
  info: (typeof TIERS)[Tier];
  direction: "upgrade" | "downgrade" | "same";
  isCurrent: boolean;
  renewalDate: string | null;
  onPress: () => void;
}

function TierBlock({
  info,
  direction,
  isCurrent,
  renewalDate,
  onPress,
}: TierBlockProps) {
  // Verb the user sees on the pill — explicit upgrade vs downgrade so the
  // direction is unambiguous at a glance.
  const verb = direction === "upgrade" ? "Upgrade" : "Downgrade";
  const ctaLabel = `${verb} to ${info.name}`;
  // Visual rule: paid targets (Plus, Pro) read as the primary action and
  // get the green filled pill regardless of upgrade/downgrade direction.
  // Only the cancellation path (Downgrade to Free) is the muted outline.
  const showFilled = info.id !== "free";
  const showOutline = info.id === "free";

  return (
    <View style={styles.tierBlock}>
      <View style={styles.tierHeader}>
        <Text style={styles.tierName}>{info.name}</Text>
        {isCurrent && <Text style={styles.currentMark}>Current plan</Text>}
      </View>
      <Text style={styles.tierPrice}>{info.priceLabel}</Text>

      <View style={styles.facts}>
        {info.facts.map((fact) => (
          <Text key={fact} style={styles.fact}>
            {fact}
          </Text>
        ))}
      </View>

      {isCurrent && renewalDate && info.id !== "free" && (
        <Text style={styles.meta}>Resets {formatRenewal(renewalDate)}</Text>
      )}

      {!isCurrent && (showFilled || showOutline) && (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            showFilled ? styles.pillFilled : styles.pillOutline,
            pressed && styles.pillPressed,
          ]}
        >
          <Text
            style={
              showFilled ? styles.pillFilledLabel : styles.pillOutlineLabel
            }
          >
            {ctaLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function formatRenewal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  back: {
    ...text.body,
    color: color.inkSecondary,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  titleBlock: {
    paddingTop: space.sm,
    paddingBottom: space.xl,
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
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  tierBlock: {
    paddingVertical: space.xl,
    gap: space.sm,
  },
  tierHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
  },
  tierName: {
    fontFamily: font.serifSemiBold,
    fontSize: 24,
    lineHeight: 30,
    color: color.ink,
    letterSpacing: -0.3,
  },
  currentMark: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: color.accent,
  },
  tierPrice: {
    fontFamily: font.sansMedium,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
    fontVariant: ["tabular-nums"],
    marginBottom: space.xs,
  },
  facts: {
    gap: space.xs,
    marginBottom: space.sm,
  },
  fact: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.ink,
  },
  meta: {
    ...text.bodySmall,
    color: color.inkSecondary,
    marginTop: space.xs,
  },
  pillFilled: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
    marginTop: space.sm,
  },
  pillFilledLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.paper,
    letterSpacing: -0.1,
  },
  pillOutline: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
    marginTop: space.sm,
  },
  pillOutlineLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.accent,
    letterSpacing: -0.1,
  },
  pillPressed: {
    opacity: 0.85,
  },
});
