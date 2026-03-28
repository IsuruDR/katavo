import { View, FlatList, Text, StyleSheet } from "react-native";
import { usePodcasts } from "../../src/hooks/usePodcasts";
import { PodcastCard } from "../../src/components/PodcastCard";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

export default function Library() {
  const { podcasts, loading, refreshing, refresh } = usePodcasts();

  if (loading) return <LoadingOverlay message="Loading library..." />;

  return (
    <View style={styles.container}>
      <FlatList
        data={podcasts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PodcastCard podcast={item} />}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No podcasts yet</Text>
            <Text style={styles.emptySubtitle}>Tap "New" to generate your first podcast</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  list: { padding: 16 },
  empty: { alignItems: "center", marginTop: 100 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: "#888" },
});
