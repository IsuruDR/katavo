// mobile/app/player/deep-dive.tsx
/**
 * Deep Dive conversation — paper-light editorial transcript with a quiet
 * voice agent loaded from the podcast's research. User input is marked
 * with a leading accent rule; AI replies sit in the open paper. No chat
 * bubbles; reads like a printed interview.
 *
 * Status, low-minutes, reconnecting, and speaking indicators are all
 * single-line typographic affordances; no animated dots or waveforms.
 *
 * End-and-resume is a quiet link above the input dock, not a heavy CTA.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDeepDive } from "../../src/hooks/useDeepDive";
import { useSubscription } from "../../src/hooks/useSubscription";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { color, font, layout, space, text } from "../../src/theme/tokens";

function formatPosition(raw: string | undefined): string {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function DeepDiveScreen() {
  const { podcastId, chapterTitle, position } = useLocalSearchParams<{
    podcastId: string;
    chapterTitle: string;
    position: string;
  }>();
  const router = useRouter();
  const { refresh: refreshSubscription } = useSubscription();

  const {
    status,
    transcript,
    minutesRemaining,
    showWarning,
    errorMessage,
    isSpeaking,
    startSession,
    endSession,
    sendTextMessage,
  } = useDeepDive();

  const [textInput, setTextInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (podcastId && chapterTitle) {
      startSession(podcastId, chapterTitle);
    }
    // startSession is stable enough for mount-only behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podcastId, chapterTitle]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  const handleEnd = async () => {
    const result = await endSession();
    if (result) refreshSubscription();
    router.back();
  };

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    sendTextMessage(trimmed);
    setTextInput("");
  };

  const positionLabel = useMemo(() => formatPosition(position), [position]);

  if (status === "connecting") {
    return <LoadingOverlay message="Connecting to researcher" />;
  }

  if (status === "error") {
    return (
      <SafeAreaView
        style={styles.root}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Couldn't connect</Text>
          {errorMessage ? (
            <Text style={styles.errorBody}>{errorMessage}</Text>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
          >
            <Text style={styles.errorAction}>Back to podcast</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerEyebrow}>Diving into</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {chapterTitle}
            </Text>
          </View>
          <View
            style={[
              styles.minutesBadge,
              showWarning && styles.minutesBadgeWarning,
            ]}
          >
            <Text
              style={[
                styles.minutesText,
                showWarning && styles.minutesTextWarning,
              ]}
            >
              {minutesRemaining} min
            </Text>
          </View>
        </View>

        {showWarning && (
          <Text style={styles.statusLine}>Less than 2 minutes left.</Text>
        )}
        {status === "reconnecting" && (
          <Text style={styles.statusLine}>Reconnecting…</Text>
        )}

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.transcriptContent}
          showsVerticalScrollIndicator={false}
        >
          {transcript.length === 0 && (
            <Text style={styles.transcriptHint}>
              Ask anything about this chapter. The researcher has the full
              source material loaded.
            </Text>
          )}

          {transcript.map((entry, i) => (
            <TranscriptEntry
              key={i}
              role={entry.role}
              text={entry.text}
              isLatest={i === transcript.length - 1}
              showSpeaking={
                isSpeaking &&
                entry.role === "assistant" &&
                i === transcript.length - 1
              }
            />
          ))}
        </ScrollView>

        <View style={styles.dock}>
          <Pressable
            onPress={handleEnd}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel={`End and resume podcast at ${positionLabel}`}
          >
            <Text style={styles.endLink}>
              End and resume podcast at {positionLabel}
            </Text>
          </Pressable>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              placeholder="Type a question"
              placeholderTextColor={color.inkTertiary}
              value={textInput}
              onChangeText={setTextInput}
              onSubmitEditing={handleSendText}
              returnKeyType="send"
              multiline
            />
            <Pressable
              onPress={handleSendText}
              disabled={!textInput.trim()}
              hitSlop={layout.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              <Text
                style={[
                  styles.sendLabel,
                  !textInput.trim() && styles.sendLabelDisabled,
                ]}
              >
                Send
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface EntryProps {
  role: "user" | "assistant";
  text: string;
  isLatest: boolean;
  showSpeaking: boolean;
}

function TranscriptEntry({ role, text, showSpeaking }: EntryProps) {
  if (role === "user") {
    return (
      <View style={styles.userEntry}>
        <View style={styles.userRule} />
        <Text style={styles.userText}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.aiEntry}>
      <Text style={styles.aiText}>{text}</Text>
      {showSpeaking && (
        <Text style={styles.aiSpeakingLine}>Researcher is speaking…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  headerEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  headerTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: color.ink,
    letterSpacing: -0.1,
  },
  minutesBadge: {
    backgroundColor: color.accentSoft,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: 999,
  },
  minutesBadgeWarning: {
    backgroundColor: color.warningSoft,
  },
  minutesText: {
    fontFamily: font.sansSemiBold,
    fontSize: 12,
    color: color.accent,
    letterSpacing: 0.3,
  },
  minutesTextWarning: {
    color: color.warning,
  },

  statusLine: {
    ...text.bodySmall,
    color: color.warning,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },

  transcriptContent: {
    paddingHorizontal: space.xl,
    paddingTop: space.base,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  transcriptHint: {
    ...text.bodySmall,
    color: color.inkSecondary,
    fontFamily: font.serifRegular,
    fontSize: 15,
    lineHeight: 22,
  },

  userEntry: {
    flexDirection: "row",
    gap: space.md,
    paddingLeft: 0,
  },
  userRule: {
    width: 2,
    alignSelf: "stretch",
    backgroundColor: color.accent,
    borderRadius: 1,
  },
  userText: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: 15,
    lineHeight: 22,
    color: color.ink,
  },

  aiEntry: {
    paddingLeft: space.md + 2,
    gap: space.xs,
  },
  aiText: {
    fontFamily: font.serifRegular,
    fontSize: 17,
    lineHeight: 26,
    color: color.ink,
  },
  aiSpeakingLine: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: color.accent,
    paddingTop: space.xs,
  },

  dock: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: space.md,
  },
  endLink: {
    ...text.bodySmall,
    color: color.inkSecondary,
    textAlign: "center",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.md,
    paddingBottom: space.xs,
  },
  textInput: {
    flex: 1,
    fontFamily: font.sansRegular,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
    minHeight: 36,
    maxHeight: 120,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.hairlineStrong,
    textAlignVertical: "top",
  },
  sendLabel: {
    fontFamily: font.sansSemiBold,
    fontSize: 15,
    color: color.accent,
    letterSpacing: 0.1,
    paddingBottom: space.sm + 2,
  },
  sendLabelDisabled: {
    color: color.inkTertiary,
  },

  errorBlock: {
    flex: 1,
    paddingHorizontal: space.xxl,
    justifyContent: "center",
    alignItems: "center",
    gap: space.base,
  },
  errorTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 22,
    color: color.ink,
    textAlign: "center",
  },
  errorBody: {
    ...text.bodySmall,
    color: color.inkSecondary,
    textAlign: "center",
  },
  errorAction: {
    fontFamily: font.sansSemiBold,
    fontSize: 15,
    color: color.accent,
    paddingTop: space.md,
  },
});
