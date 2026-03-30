// mobile/app/player/deep-dive.tsx
/**
 * Deep Dive conversation screen — full-screen voice/text chat
 * with an ElevenLabs AI agent grounded in podcast research.
 *
 * Navigated to from Player screen when user taps "Dive" on current chapter.
 * On end, returns to Player and resumes playback from saved position.
 */
import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDeepDive } from "../../src/hooks/useDeepDive";
import { useSubscription } from "../../src/hooks/useSubscription";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

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
    startSession,
    endSession,
    sendTextMessage,
  } = useDeepDive();

  const [textInput, setTextInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  // Start session on mount
  useEffect(() => {
    if (podcastId && chapterTitle) {
      startSession(podcastId, chapterTitle);
    }
  }, [podcastId, chapterTitle]);

  // Auto-scroll transcript
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  const handleEnd = async () => {
    const result = await endSession();
    if (result) {
      refreshSubscription();
    }
    router.back();
  };

  const handleSendText = () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    sendTextMessage(trimmed);
    setTextInput("");
  };

  // Loading state
  if (status === "connecting") {
    return <LoadingOverlay message="Connecting to researcher..." />;
  }

  // Error state
  if (status === "error") {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back to Podcast</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.chapterContext} numberOfLines={1}>
            Diving into: {chapterTitle}
          </Text>
        </View>
        <Text style={[styles.minutesBadge, showWarning && styles.minutesWarning]}>
          {minutesRemaining} min
        </Text>
      </View>

      {/* Warning banner */}
      {showWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            Less than 2 minutes remaining
          </Text>
        </View>
      )}

      {/* Transcript */}
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {transcript.map((entry, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              entry.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                entry.role === "user" ? styles.userText : styles.assistantText,
              ]}
            >
              {entry.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Input area */}
      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a question..."
            placeholderTextColor="#555"
            value={textInput}
            onChangeText={setTextInput}
            onSubmitEditing={handleSendText}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSendText}
            disabled={!textInput.trim()}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.endButton} onPress={handleEnd}>
          <Text style={styles.endButtonText}>End & Resume Podcast</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  headerLeft: { flex: 1, marginRight: 12 },
  chapterContext: { color: "#6366f1", fontSize: 15, fontWeight: "600" },
  minutesBadge: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "700",
    backgroundColor: "#6366f115",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  minutesWarning: { color: "#ff6b6b", backgroundColor: "#ff6b6b15" },

  // Warning banner
  warningBanner: {
    backgroundColor: "#ff6b6b20",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  warningText: { color: "#ff6b6b", fontSize: 13, textAlign: "center" },

  // Transcript
  transcript: { flex: 1 },
  transcriptContent: { padding: 16, gap: 12 },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 16 },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#6366f1",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#1a1a1a",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: "#fff" },
  assistantText: { color: "#ddd" },

  // Input
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    padding: 16,
    gap: 12,
  },
  inputRow: { flexDirection: "row", gap: 8 },
  textInput: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: "#6366f1",
    borderRadius: 20,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  endButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  endButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  // Error
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorTitle: { color: "#ff6b6b", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  errorText: { color: "#888", fontSize: 15, textAlign: "center", marginBottom: 24 },
  backButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    paddingHorizontal: 24,
  },
  backButtonText: { color: "#6366f1", fontSize: 15, fontWeight: "600" },
});
