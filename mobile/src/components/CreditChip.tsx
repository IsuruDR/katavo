// mobile/src/components/CreditChip.tsx
/**
 * CreditChip — quiet typographic credit count for screen headers.
 *
 * No background, no big number, no "remaining" filler. Just "{N} credits"
 * in ink-secondary, with the count aware of plural form. When credits hit
 * 0, ink shifts to brick-warning to flag the constraint without a banner.
 */
import { StyleSheet, Text } from "react-native";
import { color, font, space } from "../theme/tokens";

interface Props {
  count: number;
}

export function CreditChip({ count }: Props) {
  const empty = count <= 0;
  return (
    <Text
      style={[styles.chip, empty && styles.chipEmpty]}
      accessibilityLabel={`${count} ${count === 1 ? "credit" : "credits"} remaining`}
    >
      {count} {count === 1 ? "credit" : "credits"}
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
