/**
 * UpgradeRow — type-led trigger row for paywalled features. Used wherever
 * a feature is visible but locked behind a higher tier.
 *
 * Editorial register: no lock icons, no faded blur, no card. State lives
 * entirely in the typography per the Status-In-Type rule from DESIGN.md.
 *
 *   Eyebrow (smoke caption, optional)
 *   Title   (Plex Serif SemiBold ink — feature name reads at full strength
 *            even though the feature is locked, because it's still real)
 *   Trigger (Plex Sans Medium accent — "Unlock with Plus" / "Unlock with Pro")
 *   Chevron (smoke, vertically centred)
 *
 * The whole row is the tap target. Caller wires the destination — usually
 * router.push("/plans") — so this component stays presentation-only.
 *
 * Designed to fit alongside Account NavRow / Section components: the
 * caller renders the leading hairline divider so the row drops into any
 * stack without extra rules.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TIERS } from "../lib/tiers";
import type { Tier } from "../lib/tiers";
import { color, font, space } from "../theme/tokens";

interface Props {
  /** Optional uppercase caption above the title — usually the feature name. */
  eyebrow?: string;
  /** Plain-language description of what the feature does. */
  title: string;
  /** Minimum tier required to use the feature. Drives the trigger copy. */
  unlockTier: Exclude<Tier, "free">;
  onPress: () => void;
}

export function UpgradeRow({ eyebrow, title, unlockTier, onPress }: Props) {
  const triggerLabel = "Upgrade to Unlock";
  // Accessibility label still names the tier so screen-reader users get
  // the full context the visible copy doesn't carry.
  const tierName = TIERS[unlockTier].name;
  const a11yLabel = eyebrow
    ? `${eyebrow}: ${title} Upgrade to ${tierName} to unlock.`
    : `${title} Upgrade to ${tierName} to unlock.`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.trigger}>{triggerLabel}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={color.inkSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  pressed: {
    opacity: 0.55,
  },
  body: {
    flex: 1,
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
  title: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  trigger: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.accent,
    marginTop: space.xs,
  },
});
