import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditBalance } from "../../src/components/CreditBalance";
import { ClarifyingChat } from "../../src/components/ClarifyingChat";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { generateQuestions, submitPodcast } from "../../src/services/podcast";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function Generate() {
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [questions, setQuestions] = useState<string[]>([]);
  const { subscription, refresh: refreshSub } = useSubscription();
  const router = useRouter();

  const handleStartGeneration = async () => {
    if (!topic.trim()) return;
    if (!subscription || subscription.creditsRemaining < 1) {
      Alert.alert("No Credits", "Purchase more credits to generate a podcast.");
      return;
    }

    setPhase("loading-questions");
    try {
      const qs = await generateQuestions(topic.trim());
      setQuestions(qs);
      setPhase("clarifying");
    } catch (error: any) {
      Alert.alert("Error", error.message);
      setPhase("input");
    }
  };

  const handleClarifyingComplete = async (answers: Array<{ q: string; a: string }>) => {
    setPhase("submitting");
    try {
      await submitPodcast(topic.trim(), answers);
      refreshSub();
      Alert.alert("Podcast Generating", "We'll notify you when it's ready!", [
        { text: "OK", onPress: () => { setPhase("input"); setTopic(""); router.push("/(tabs)"); } },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.message);
      setPhase("input");
    }
  };

  if (phase === "loading-questions") return <LoadingOverlay message="Preparing questions..." />;
  if (phase === "submitting") return <LoadingOverlay message="Starting generation..." />;

  if (phase === "clarifying") {
    return (
      <View style={styles.container}>
        <ClarifyingChat
          questions={questions}
          onComplete={handleClarifyingComplete}
          onCancel={() => setPhase("input")}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {subscription && <CreditBalance subscription={subscription} />}
        <Text style={styles.title}>What do you want to learn about?</Text>
        <TextInput
          style={styles.topicInput}
          value={topic}
          onChangeText={setTopic}
          placeholder="e.g., the impact of quantum computing on cryptography"
          placeholderTextColor="#666"
          multiline
        />
        <TouchableOpacity
          style={[styles.generateButton, !topic.trim() && styles.disabled]}
          onPress={handleStartGeneration}
          disabled={!topic.trim()}
        >
          <Text style={styles.generateText}>Generate Podcast (1 credit)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { flex: 1, padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff", marginTop: 16 },
  topicInput: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    color: "#fff", fontSize: 16, minHeight: 100, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#333",
  },
  generateButton: {
    backgroundColor: "#6366f1", borderRadius: 12, padding: 16,
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
  generateText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
