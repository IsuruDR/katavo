/**
 * SearchField — bottom-rule input for filtering the Library by topic.
 *
 * Editorial restraint: no magnifying-glass icon, no border, no surrounding
 * card. Just a single Vellum hairline at the bottom and Pencil placeholder
 * copy. The placeholder ("Search topics") is the affordance.
 *
 * When the value is non-empty, a typographic "Clear" link appears
 * flush-right inside the row. Clearing isn't a primary action so the link
 * is Smoke, not Library Green.
 *
 * Always rendered controlled — owner manages the value and decides when
 * to mount this (Library shows it only past the search threshold).
 */
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, font, layout, space } from "../theme/tokens";

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search topics",
}: Props) {
  const hasValue = value.length > 0;

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.inkTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search podcast topics"
      />
      {hasValue && (
        <Pressable
          onPress={() => onChangeText("")}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text style={styles.clear}>Clear</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineStrong,
  },
  input: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: 17,
    lineHeight: 24,
    color: color.ink,
    padding: 0,
  },
  clear: {
    fontFamily: font.sansSemiBold,
    fontSize: 13,
    color: color.inkSecondary,
    letterSpacing: 0.2,
  },
});
