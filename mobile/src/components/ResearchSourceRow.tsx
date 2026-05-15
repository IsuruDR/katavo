/**
 * One entry in a per-chapter sources subsection: [N] · title · host.
 * Tap opens the URL externally. Global index (1-indexed) is shown on
 * the left so the row visually pairs with [N] markers in the prose.
 */
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  /** 1-indexed citation number (the [N] shown in prose). */
  n: number;
  title: string;
  url: string;
}

/**
 * Sources flow from the LLM-synthesized research_document. The server-side
 * sanitizer drops fabricated URLs and non-http(s) schemes (see SEC-3), but
 * we belt-and-brace on the client too. Only http(s) URLs are ever passed
 * to Linking.openURL; anything else renders as an unclickable row labeled
 * "Source unavailable" rather than risking a tel:/sms: pivot from an
 * indirect-prompt-injection chain that bypassed the server filter.
 */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchSourceRow({ n, title, url }: Props) {
  const openable = isHttpUrl(url);

  const onPress = async () => {
    if (!openable) return;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
    } catch {
      // silent
    }
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={openable ? "link" : "text"}
      accessibilityLabel={openable ? `Source ${n}: ${title}` : `Source ${n}: unavailable`}
      disabled={!openable}
      style={({ pressed }) => [
        styles.row,
        pressed && openable && styles.rowPressed,
        !openable && styles.rowDisabled,
      ]}
    >
      <Text style={styles.number}>{`[${n}]`}</Text>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {openable ? title : "Source unavailable"}
        </Text>
        {openable && (
          <Text style={styles.host} numberOfLines={1}>
            {hostFromUrl(url)}
          </Text>
        )}
      </View>
      {openable && <Feather name="external-link" size={16} color={color.inkSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: space.sm,
    gap: space.sm,
  },
  rowPressed: { opacity: 0.55 },
  rowDisabled: { opacity: 0.5 },
  number: {
    fontFamily: font.sansSemiBold,
    fontSize: 14,
    color: color.accent,
    width: 36,
    paddingTop: 2,
  },
  body: {
    flex: 1,
    gap: space.xxs,
  },
  title: {
    ...text.bodySmall,
    color: color.ink,
    fontFamily: font.sansMedium,
  },
  host: {
    ...text.bodySmall,
    color: color.inkSecondary,
    fontSize: 12,
  },
});
