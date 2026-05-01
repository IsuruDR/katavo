/**
 * VoicePicker — reusable voice selection UI. Used by:
 *   - Onboarding screen 2 (initial pick)
 *   - Account → Voice settings (edit)
 *
 * Plays bundled sample mp3 on tap via expo-audio. Calls onSelect with
 * the voice ID when the user taps the CTA. Caller handles persistence.
 */

import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { VOICES, type VoiceMeta } from "../lib/voiceSamples";

interface Props {
  initialValue?: string;
  onSelect: (voice: string) => void | Promise<void>;
  ctaLabel?: string;
  helperText?: string;
}

export function VoicePicker({
  initialValue,
  onSelect,
  ctaLabel = "Continue",
  helperText,
}: Props) {
  const [picked, setPicked] = useState<string | null>(initialValue ?? null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount — release any active player.
      playerRef.current?.release();
      playerRef.current = null;
    };
  }, []);

  const playSample = (voice: VoiceMeta) => {
    try {
      // Release any currently-playing sample first.
      playerRef.current?.release();
      playerRef.current = null;

      const player = createAudioPlayer(voice.sample);
      playerRef.current = player;
      setPlayingId(voice.id);

      // Detect when the sample finishes — flip the playing indicator off.
      // Heuristic: status update where currentTime is within 100ms of duration,
      // or where playing flipped to false after having loaded.
      const sub = player.addListener("playbackStatusUpdate", (status) => {
        const d = status.duration ?? 0;
        const t = status.currentTime ?? 0;
        if (d > 0 && t >= d - 0.1) {
          setPlayingId((current) => (current === voice.id ? null : current));
          sub.remove();
        }
      });

      player.play();
    } catch (err) {
      console.error("Sample playback failed:", err);
      setPlayingId(null);
    }
  };

  const handleSubmit = async () => {
    if (!picked || submitting) return;
    setSubmitting(true);
    try {
      await onSelect(picked);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        {VOICES.map((voice) => {
          const isPicked = picked === voice.id;
          const isPlaying = playingId === voice.id;
          return (
            <TouchableOpacity
              key={voice.id}
              style={[styles.card, isPicked && styles.cardPicked]}
              onPress={() => {
                setPicked(voice.id);
                playSample(voice);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.cardBody}>
                <Text style={styles.name}>{voice.name}</Text>
                <Text style={styles.descriptor}>{voice.descriptor}</Text>
              </View>
              <View style={styles.playBadge}>
                <Text style={styles.playBadgeText}>{isPlaying ? "▶︎" : "▶"}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {helperText && <Text style={styles.helper}>{helperText}</Text>}

      <TouchableOpacity
        style={[styles.cta, (!picked || submitting) && styles.ctaDisabled]}
        onPress={handleSubmit}
        disabled={!picked || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16 },
  list: { gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  cardPicked: { borderColor: "#6366f1", borderWidth: 2 },
  cardBody: { flex: 1 },
  name: { fontSize: 18, fontWeight: "600", color: "#fff", marginBottom: 4 },
  descriptor: { fontSize: 14, color: "#aaa" },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
  },
  playBadgeText: { color: "#fff", fontSize: 14 },
  helper: { fontSize: 13, color: "#888", textAlign: "center", marginTop: 8 },
  cta: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: "auto",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
