// mobile/app/(tabs)/sources.tsx
import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

interface TrustedSource {
  id: string;
  name: string;
  urls: Array<{ url: string; label: string }>;
}

export default function Sources() {
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const [sources, setSources] = useState<TrustedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const fetchSources = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("trusted_sources")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setSources(data as unknown as TrustedSource[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  if (loading) return <LoadingOverlay message="Loading sources..." />;

  if (subscription?.tier !== "pro") {
    return (
      <View style={styles.locked}>
        <Text style={styles.lockedTitle}>Pro Feature</Text>
        <Text style={styles.lockedSubtitle}>
          Upgrade to Pro to curate trusted sources for your podcasts.
        </Text>
      </View>
    );
  }

  const handleAddSource = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const { error } = await supabase.from("trusted_sources").insert({
      user_id: user!.id,
      name: newName.trim(),
      urls: [{ url: newUrl.trim(), label: newName.trim() }],
    });
    if (error) { Alert.alert("Error", error.message); return; }
    setNewName("");
    setNewUrl("");
    fetchSources();
  };

  return (
    <View style={styles.container}>
      <View style={styles.addForm}>
        <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Collection name" placeholderTextColor="#666" />
        <TextInput style={styles.input} value={newUrl} onChangeText={setNewUrl} placeholder="URL" placeholderTextColor="#666" autoCapitalize="none" />
        <TouchableOpacity style={styles.addButton} onPress={handleAddSource}>
          <Text style={styles.addText}>Add Source</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={sources}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.sourceCard}>
            <Text style={styles.sourceName}>{item.name}</Text>
            <Text style={styles.sourceCount}>{item.urls.length} URLs</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No trusted sources yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 16 },
  locked: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center", padding: 24 },
  lockedTitle: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 8 },
  lockedSubtitle: { fontSize: 16, color: "#888", textAlign: "center" },
  addForm: { gap: 8, marginBottom: 16 },
  input: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12, color: "#fff", borderWidth: 1, borderColor: "#333" },
  addButton: { backgroundColor: "#6366f1", borderRadius: 12, padding: 12, alignItems: "center" },
  addText: { color: "#fff", fontWeight: "600" },
  sourceCard: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, marginBottom: 8 },
  sourceName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  sourceCount: { color: "#888", fontSize: 13, marginTop: 4 },
  empty: { color: "#888", textAlign: "center", marginTop: 40 },
});
