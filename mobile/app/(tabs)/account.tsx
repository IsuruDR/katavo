// mobile/app/(tabs)/account.tsx
/**
 * Account — paper-light editorial settings page.
 *
 * Sections separated by hairlines, each with an uppercase Label eyebrow and
 * a serif value line. No cards. Plan + Deep Dive minutes (paid only) +
 * Voice. Three actions at the bottom: buy extra credit, upgrade (free only),
 * sign out.
 *
 * SubscriptionModal and PaywallScreen still render in the legacy dark
 * theme; they trigger from this screen's actions and are queued for a
 * polish pass.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { useProfile } from "../../src/hooks/useProfile";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { SubscriptionModal } from "../../src/components/SubscriptionModal";
import { PaywallScreen } from "../../src/components/PaywallScreen";
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
  const [showPaywall, setShowPaywall] = useState(false);

  if (loading) return <LoadingOverlay message="Loading account" />;

  const tierLabel = TIER_LABELS[subscription?.tier ?? "free"];
  const creditPrice = CREDIT_PRICES[subscription?.tier ?? "free"];
  const credits = subscription?.creditsRemaining ?? 0;
  const isFree = subscription?.tier === "free";
  const hasDeepDive = !!subscription && subscription.tier !== "free";
  const renewal = formatRenewalDate(subscription?.renewalDate ?? null);

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

        <Section eyebrow="Plan">
          <Text style={styles.sectionValue}>{tierLabel}</Text>
          <Text style={styles.sectionMeta}>
            {credits} {credits === 1 ? "credit" : "credits"} remaining
            {renewal ? ` · resets ${renewal}` : ""}
          </Text>
        </Section>

        {hasDeepDive && subscription && (
          <Section eyebrow="Deep Dive">
            <Text style={styles.sectionValue}>
              {subscription.deepDiveMinutesRemaining} of{" "}
              {subscription.deepDiveMinutesPerMonth} minutes
            </Text>
            {renewal && (
              <Text style={styles.sectionMeta}>Resets {renewal}</Text>
            )}
          </Section>
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
          {isFree && (
            <FilledPill
              label="Upgrade to Plus"
              onPress={() => setShowPaywall(true)}
            />
          )}
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
        visible={showCreditModal}
        tier={subscription?.tier || "free"}
        onClose={() => setShowCreditModal(false)}
        onPurchased={refresh}
      />
      {showPaywall && (
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onPurchased={() => {
            setShowPaywall(false);
            refresh();
          }}
        />
      )}
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
  onPress: () => void;
}

function NavRow({ eyebrow, value, onPress }: NavRowProps) {
  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${eyebrow}: ${value}`}
        style={({ pressed }) => [styles.navRow, pressed && styles.navRowPressed]}
      >
        <View style={styles.navRowBody}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.sectionValue}>{value}</Text>
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

function FilledPill({ label, onPress }: PillProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pillFilled,
        pressed && styles.pillPressed,
      ]}
    >
      <Text style={styles.pillFilledLabel}>{label}</Text>
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
  pillFilled: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  pillFilledLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 16,
    color: color.paper,
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
