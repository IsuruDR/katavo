// mobile/app/(tabs)/account.tsx
/**
 * Account — paper-light editorial settings page.
 *
 * Sections separated by hairlines, each with an uppercase Label eyebrow and
 * a serif value line. No cards. Plan, Deep Dive minutes (paid only), Voice
 * — each tappable row pushes to its dedicated screen. Two actions at the
 * bottom: buy extra credit, sign out.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { useProfile } from "../../src/hooks/useProfile";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { SubscriptionModal } from "../../src/components/SubscriptionModal";
import { PurchaseFailureSheet } from "../../src/components/PurchaseFailureSheet";
import { CreditAddedSheet } from "../../src/components/CreditAddedSheet";
import { UpgradeRow } from "../../src/components/UpgradeRow";
import type { SwitchFailure } from "../../src/lib/switchErrors";
import { getStoreSubscriptionUrl } from "../../src/lib/tiers";
import { color, font, layout, space, text } from "../../src/theme/tokens";

const CREDIT_PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
};

function capitalize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRenewalDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function Account() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { subscription, loading, refresh } = useSubscription();
  const { profile } = useProfile();
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditFailure, setCreditFailure] = useState<SwitchFailure | null>(null);
  const [creditCelebration, setCreditCelebration] = useState<{
    creditsAfter: number;
  } | null>(null);
  // Optimistic delta added to the credit count the moment a purchase
  // resolves on RevenueCat. Cleared once the server-side row catches up
  // (RC webhook → Supabase update → useSubscription refetch).
  const [optimisticCredits, setOptimisticCredits] = useState(0);

  // Refetch every time Account regains focus so a tier change made on
  // /plans is reflected here without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const serverCredits = subscription?.creditsRemaining ?? 0;

  // Drop the optimistic bump as soon as the server-side credit count has
  // moved by at least the bumped amount. Conservative match — avoids
  // double-counting if the user buys multiple credits in a row.
  useEffect(() => {
    if (optimisticCredits === 0) return;
    setOptimisticCredits(0);
    // Intentionally re-run only when serverCredits changes; the
    // optimistic delta is a one-shot bump, not a sticky override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCredits]);

  if (loading) return <LoadingOverlay message="Loading account" />;

  const tierLabel = TIER_LABELS[subscription?.tier ?? "free"];
  const creditPrice = CREDIT_PRICES[subscription?.tier ?? "free"];
  const credits = serverCredits + optimisticCredits;
  const hasDeepDive = !!subscription && subscription.tier !== "free";
  const renewal = formatRenewalDate(subscription?.renewalDate ?? null);
  const creditsLabel = `${credits} ${credits === 1 ? "credit" : "credits"}`;
  const planSubtitle = renewal
    ? `${creditsLabel} · resets ${renewal}`
    : creditsLabel;

  const handleCreditPurchased = () => {
    const next = serverCredits + optimisticCredits + 1;
    setOptimisticCredits((n) => n + 1);
    setCreditCelebration({ creditsAfter: next });
    void refresh();
  };

  const handleCreditFailureRetry = () => {
    setCreditFailure(null);
    setShowCreditModal(true);
  };

  const handleCreditFailureSecondary = () => {
    if (creditFailure?.secondary === "openSettings") {
      void Linking.openURL(getStoreSubscriptionUrl());
    }
    setCreditFailure(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
          {user?.email && <Text style={styles.email}>{user.email}</Text>}
        </View>

        <NavRow
          eyebrow="Plan"
          value={tierLabel}
          subtitle={planSubtitle}
          onPress={() => router.push("/plans")}
        />

        {hasDeepDive && subscription ? (
          <Section eyebrow="Deep Dive">
            <Text style={styles.sectionValue}>
              {subscription.deepDiveMinutesRemaining} of{" "}
              {subscription.deepDiveMinutesPerMonth} minutes
            </Text>
            {renewal && (
              <Text style={styles.sectionMeta}>Resets {renewal}</Text>
            )}
          </Section>
        ) : (
          <View>
            <View style={styles.divider} />
            <UpgradeRow
              eyebrow="Deep Dive"
              title="Voice Q&A on your podcast."
              unlockTier="plus"
              onPress={() => router.push("/plans")}
            />
          </View>
        )}

        <NavRow
          eyebrow="Voice"
          value={capitalize(profile?.preferredVoice ?? null)}
          onPress={() => router.push("/voice-settings")}
        />

        <View style={styles.actions}>
          <OutlinePill
            label={`Buy extra credit ($${creditPrice})`}
            onPress={() => setShowCreditModal(true)}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={signOut}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <SubscriptionModal
        visible={
          showCreditModal &&
          creditFailure === null &&
          creditCelebration === null
        }
        tier={subscription?.tier || "free"}
        onClose={() => setShowCreditModal(false)}
        onPurchased={handleCreditPurchased}
        onError={(failure) => setCreditFailure(failure)}
      />

      <PurchaseFailureSheet
        visible={creditFailure !== null}
        failure={creditFailure}
        eyebrow="Couldn't buy"
        onRetry={handleCreditFailureRetry}
        onSecondary={handleCreditFailureSecondary}
        onDismiss={() => setCreditFailure(null)}
      />

      <CreditAddedSheet
        visible={creditCelebration !== null}
        creditsAfter={creditCelebration?.creditsAfter ?? 0}
        onDismiss={() => {
          setCreditCelebration(null);
          router.replace("/(tabs)/generate");
        }}
      />
    </SafeAreaView>
  );
}

interface SectionProps {
  eyebrow: string;
  children: React.ReactNode;
}

function Section({ eyebrow, children }: SectionProps) {
  return (
    <View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {children}
      </View>
    </View>
  );
}

interface NavRowProps {
  eyebrow: string;
  value: string;
  /**
   * Optional second line below the value. Same visual treatment as
   * UpgradeRow's trigger so locked rows and informational rows read with
   * a consistent rhythm in the Account stack.
   */
  subtitle?: string;
  onPress: () => void;
}

function NavRow({ eyebrow, value, subtitle, onPress }: NavRowProps) {
  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          subtitle ? `${eyebrow}: ${value}. ${subtitle}` : `${eyebrow}: ${value}`
        }
        style={({ pressed }) => [styles.navRow, pressed && styles.navRowPressed]}
      >
        <View style={styles.navRowBody}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.sectionValue}>{value}</Text>
          {subtitle && <Text style={styles.navRowSubtitle}>{subtitle}</Text>}
        </View>
        <Feather name="chevron-right" size={20} color={color.inkSecondary} />
      </Pressable>
    </View>
  );
}

interface PillProps {
  label: string;
  onPress: () => void;
}

function OutlinePill({ label, onPress }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pillOutline,
        pressed && styles.pillPressed,
      ]}
    >
      <Text style={styles.pillOutlineLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  header: {
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.xs,
  },
  title: {
    ...text.displaySerif,
  },
  email: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  section: {
    paddingVertical: space.lg,
    gap: space.xxs,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.xs,
  },
  sectionValue: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  sectionMeta: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  navRowPressed: {
    opacity: 0.55,
  },
  navRowBody: {
    flex: 1,
  },
  navRowSubtitle: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.accent,
    marginTop: space.xs,
  },
  actions: {
    paddingTop: space.xxl,
    gap: space.md,
  },
  pillOutline: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
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
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.lg,
    alignItems: "center",
  },
  signOut: {
    ...text.bodySmall,
    color: color.warning,
  },
});
