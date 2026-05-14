/**
 * Shared player-screen NavRow: divider + pressable row with
 * eyebrow, title, optional subtitle, and chevron. Used by
 * ResearchNavRow and ShareNavRow.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel: string;
}

export function NavRow({ eyebrow, title, subtitle, onPress, accessibilityLabel }: Props) {
  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <Feather name="chevron-right" size={20} color={color.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: color.hairline },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rowPressed: { opacity: 0.55 },
  body: { flex: 1, gap: space.xxs },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  title: { ...text.titleSerif, fontSize: 19, lineHeight: 26 },
  subtitle: { ...text.body, fontSize: 13, color: color.inkSecondary, marginTop: 2 },
});
