/**
 * ResearchNavRow, sits below the chapter list in the player.
 *
 * Tier-gated: free users see "Research · Plus" eyebrow and route to
 * /plans. Plus+ users see "Research" and route to the research screen.
 *
 * Hidden when podcastStatus !== "complete" (in-flight or failed
 * podcasts have no research to surface).
 */
import { useRouter } from "expo-router";
import { useSubscription } from "../hooks/useSubscription";
import { isFeatureUnlocked } from "../lib/tiers";
import { NavRow } from "./NavRow";

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
      router.push({ pathname: "/plans", params: { context: "research" } });
    }
  };

  return (
    <NavRow
      eyebrow="Research"
      title="Sources behind this episode"
      onPress={onPress}
      accessibilityLabel={
        unlocked
          ? "Open research and sources behind this episode"
          : "Sources behind this episode. Upgrade to access the research."
      }
    />
  );
}
