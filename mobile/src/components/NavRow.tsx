/**
 * Shared player-screen NavRow: divider + pressable row with a 2px
 * Library Green leading rule (the system's signature "margin note"
 * ink-stamp), a serif title, an optional smoke subtitle, and a smoke
 * chevron right. Used by ResearchNavRow and ShareNavRow as quiet
 * reach-arounds beneath the chapter list.
 *
 * The leading rule extends the brand vocabulary already established
 * by PodcastRow's in-flight indicator. Here it sits static — the row
 * is always "active" (no in-flight state) so the rule is solid, not
 * pulsing. The shared rule pattern makes the player surface read as
 * one coherent editorial system rather than a mix of UI registers.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, space, text } from "../theme/tokens";

interface Props {
  title: string;
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel: string;
}

export function NavRow({ title, subtitle, onPress, accessibilityLabel }: Props) {
  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.rule} />
        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        <View style={styles.chevronWrap}>
          <Feather name="chevron-right" size={20} color={color.inkSecondary} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: color.hairline },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rowPressed: { opacity: 0.55 },
  rule: {
    width: 2,
    alignSelf: "stretch",
    borderRadius: 1,
    backgroundColor: color.accent,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    gap: 2,
  },
  title: {
    ...text.titleSerif,
    fontSize: 17,
    lineHeight: 24,
  },
  subtitle: {
    ...text.body,
    fontSize: 13,
    color: color.inkSecondary,
  },
  chevronWrap: {
    justifyContent: "center",
  },
});
