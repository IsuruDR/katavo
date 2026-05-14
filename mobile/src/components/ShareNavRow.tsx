/**
 * ShareNavRow, sits below ResearchNavRow on the player.
 *
 * Anyone (Free/Plus/Pro) can share a completed podcast via a public link.
 * Tap calls the issue-token endpoint (idempotent), then opens the native
 * share sheet. The NavRow subtitle states what becomes public so users
 * decide before the sheet opens. No confirmation modal.
 *
 * Hidden when podcastStatus !== "complete".
 */
import { useState } from "react";
import { Alert, Share } from "react-native";
import { NavRow } from "./NavRow";
import { issueShareToken } from "../services/podcast";

// EXPO_PUBLIC_* values are baked at build time. When the custom domain
// ships, set EXPO_PUBLIC_SHARE_BASE_URL in EAS and cut a new build;
// until then we fall back to the pipeline URL since the share page is
// served from the same Hono server.
const SHARE_BASE =
  process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? process.env.EXPO_PUBLIC_API_URL;

interface Props {
  podcastId: string;
  podcastStatus: string;
  topic: string;
  shareToken: string | null;
  onTokenIssued: (token: string) => void;
}

export function ShareNavRow({
  podcastId,
  podcastStatus,
  topic,
  shareToken,
  onTokenIssued,
}: Props) {
  const [busy, setBusy] = useState(false);

  if (podcastStatus !== "complete") return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let token = shareToken;
      if (!token) {
        token = await issueShareToken(podcastId);
        onTokenIssued(token);
      }
      const shareUrl = `${SHARE_BASE}/p/${token}`;
      await Share.share({
        url: shareUrl,
        message: `${topic}\n\n${shareUrl}`,
        title: topic,
      });
    } catch (err) {
      console.warn("ShareNavRow tap failed:", err);
      Alert.alert(
        "Couldn't share",
        err instanceof Error && err.message ? err.message : "Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <NavRow
      eyebrow="Share"
      title={shareToken ? "Copy link" : "Share this episode"}
      subtitle={
        shareToken ? "Audio and chapters are public" : "Audio and chapters become public"
      }
      onPress={onPress}
      accessibilityLabel={
        shareToken
          ? "Share this podcast link"
          : "Generate a public link and share this podcast"
      }
    />
  );
}
