/**
 * VoicePicker — reusable voice selection UI. Used by:
 *   - Onboarding screen 2 (initial pick)
 *   - Account → Voice settings (edit)
 *
 * Plays bundled sample mp3 on tap via expo-audio. Calls onSelect with
 * the voice ID when the user taps the CTA. Caller handles persistence.
 *
 * Each voice is a flat row: optional leading 2px Library Green rule for
 * the picked voice, Plex Serif name, ink-secondary descriptor, typographic
 * play indicator on the right (▶ glyph at rest, "PLAYING" eyebrow when
 * the sample is rolling).
 */
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { color, font, space, text } from "../theme/tokens";
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
      playerRef.current?.release();
      playerRef.current = null;
    };
  }, []);

  const playSample = (voice: VoiceMeta) => {
    try {
      playerRef.current?.release();
      playerRef.current = null;

      const player = createAudioPlayer(voice.sample);
      playerRef.current = player;
      setPlayingId(voice.id);

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

  const canSubmit = !!picked && !submitting;

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        {VOICES.map((voice, i) => {
          const isPicked = picked === voice.id;
          const isPlaying = playingId === voice.id;
          return (
            <View key={voice.id}>
              {i > 0 && <View style={styles.divider} />}
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setPicked(voice.id);
                  playSample(voice);
                }}
                activeOpacity={0.55}
                accessibilityRole="button"
                accessibilityLabel={`${voice.name} voice — ${voice.descriptor}`}
                accessibilityState={{ selected: isPicked }}
              >
                <View
                  style={[styles.rule, isPicked && styles.ruleActive]}
                />
                <View style={styles.body}>
                  <Text
                    style={isPicked ? styles.namePicked : styles.name}
                  >
                    {voice.name}
                  </Text>
                  <Text style={styles.descriptor}>{voice.descriptor}</Text>
                </View>
                {isPlaying ? (
                  <Text style={styles.playing}>PLAYING</Text>
                ) : (
                  <Text style={styles.playGlyph}>▶</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {helperText && <Text style={styles.helper}>{helperText}</Text>}

      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.cta,
          !canSubmit && styles.ctaDisabled,
          pressed && canSubmit && styles.ctaPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityState={{ disabled: !canSubmit }}
      >
        <Text style={styles.ctaLabel}>
          {submitting ? "Saving" : ctaLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: space.lg,
  },
  list: {
    gap: 0,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space.md,
    paddingVertical: space.lg,
  },
  rule: {
    width: 2,
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderRadius: 1,
  },
  ruleActive: {
    backgroundColor: color.accent,
  },
  body: {
    flex: 1,
    gap: space.xxs,
    justifyContent: "center",
  },
  name: {
    fontFamily: font.serifMedium,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  namePicked: {
    fontFamily: font.serifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: color.ink,
    letterSpacing: -0.2,
  },
  descriptor: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  playGlyph: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    color: color.inkTertiary,
    paddingTop: 4,
  },
  playing: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
    paddingTop: 6,
  },
  helper: {
    ...text.bodySmall,
    color: color.inkSecondary,
    textAlign: "center",
  },
  cta: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaDisabled: {
    backgroundColor: color.hairlineStrong,
  },
  ctaLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 17,
    color: color.paper,
    letterSpacing: -0.1,
  },
});
