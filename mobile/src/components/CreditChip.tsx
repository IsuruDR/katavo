// mobile/src/components/CreditChip.tsx
/**
 * CreditChip — quiet typographic credit count for screen headers.
 *
 * No background, no big number, no "remaining" filler. When the user has
 * both monthly credits and a bonus credit (migration 00025), render the
 * two numbers separately so the gift stays visible — "{monthly} + {bonus}
 * credits". Otherwise, render a single total. When all buckets are empty,
 * ink shifts to brick-warning to flag the constraint without a banner.
 *
 * `count` is the combined total. `bonus` is optional; when > 0 it triggers
 * the split-display variant. Callers that don't pass bonus get the legacy
 * single-number behavior.
 */
import { StyleSheet, Text } from "react-native";
import { color, font, space } from "../theme/tokens";

interface Props {
  count: number;
  bonus?: number;
}

export function CreditChip({ count, bonus = 0 }: Props) {
  const empty = count <= 0;
  const monthly = Math.max(0, count - bonus);
  const showSplit = bonus > 0 && monthly > 0;
  const label = empty
    ? "0 credits"
    : showSplit
      ? `${monthly} + ${bonus} credits`
      : `${count} ${count === 1 ? "credit" : "credits"}`;
  const a11y = showSplit
    ? `${monthly} monthly ${monthly === 1 ? "credit" : "credits"}, ${bonus} free ${bonus === 1 ? "credit" : "credits"}, ${count} total`
    : `${count} ${count === 1 ? "credit" : "credits"} remaining`;
  return (
    <Text
      style={[styles.chip, empty && styles.chipEmpty]}
      accessibilityLabel={a11y}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: {
    fontFamily: font.sansMedium,
    fontSize: 13,
    color: color.inkSecondary,
    fontVariant: ["tabular-nums"],
    paddingVertical: space.xs,
  },
  chipEmpty: {
    color: color.warning,
  },
});
