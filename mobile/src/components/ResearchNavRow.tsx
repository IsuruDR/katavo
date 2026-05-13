/**
 * ResearchNavRow, sits below the chapter list in the player.
 *
 * Tier-gated: free users see "Research · Plus" eyebrow and route to
 * /plans. Plus+ users see "Research" and route to the research screen.
 *
 * Hidden when podcastStatus !== "complete" (in-flight or failed
 * podcasts have no research to surface).
 *
 * The hook handles the "no research_contexts row" empty state on the
 * screen itself; we don't pre-check here.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSubscription } from "../hooks/useSubscription";
import { isFeatureUnlocked } from "../lib/tiers";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  podcastId: string;
  podcastStatus: string;
}

export function ResearchNavRow({ podcastId, podcastStatus }: Props) {
  const router = useRouter();
  const { subscription } = useSubscription();

  if (podcastStatus !== "complete") return null;

  const tier = subscription?.tier ?? "free";
  const unlocked = isFeatureUnlocked("research", tier);

  const onPress = () => {
    if (unlocked) {
      router.push(`/player/${podcastId}/research`);
    } else {
      // Pass context so /plans contextualises its title to "Upgrade to
      // see the Research" instead of the generic "Pick your shelf."
      router.push({ pathname: "/plans", params: { context: "research" } });
    }
  };

  return (
    <View>
      <View style={styles.divider} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          unlocked
            ? "Open research and sources behind this episode"
            : "Sources behind this episode. Upgrade to access the research."
        }
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Research</Text>
          <Text style={styles.title}>Sources behind this episode</Text>
        </View>
        <Feather name="chevron-right" size={20} color={color.inkSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.lg,
    gap: space.md,
  },
  rowPressed: {
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
    color: color.accent,
  },
  title: {
    ...text.titleSerif,
    fontSize: 19,
    lineHeight: 26,
  },
});
