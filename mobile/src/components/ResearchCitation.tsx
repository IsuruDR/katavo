/**
 * Inline tappable [N] citation. Renders as <Text onPress> so it sits
 * inline with surrounding prose Text. Opens the source URL externally
 * via Linking.openURL on tap; silent on failure (user can use the
 * per-chapter sources list below).
 */
import { Linking, StyleSheet, Text } from "react-native";
import { color, font } from "../theme/tokens";

interface Props {
  n: number;
  sourceUrl: string | null;
}

export function ResearchCitation({ n, sourceUrl }: Props) {
  const onPress = async () => {
    if (!sourceUrl) return;
    try {
      const supported = await Linking.canOpenURL(sourceUrl);
      if (supported) await Linking.openURL(sourceUrl);
    } catch {
      // silent; the per-chapter sources list below offers another path
    }
  };

  return (
    <Text
      style={styles.citation}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Source ${n}`}
    >{` [${n}]`}</Text>
  );
}

const styles = StyleSheet.create({
  citation: {
    fontFamily: font.sansSemiBold,
    color: color.accent,
  },
});
