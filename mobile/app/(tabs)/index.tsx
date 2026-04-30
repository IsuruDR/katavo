import { useMemo } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePodcasts } from "../../src/hooks/usePodcasts";
import { PodcastRow } from "../../src/components/PodcastRow";
import { color, space, text } from "../../src/theme/tokens";

export default function Library() {
  const { podcasts, loading, refreshing, refresh } = usePodcasts();

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={refresh}
        tintColor={color.accent}
        colors={[color.accent]}
        progressBackgroundColor={color.paper}
      />
    ),
    [refreshing, refresh],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {loading ? (
        <SkeletonList />
      ) : (
        <FlatList
          data={podcasts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PodcastRow podcast={item} />}
          ItemSeparatorComponent={Divider}
          ListHeaderComponent={<LibraryHeader count={podcasts.length} />}
          contentContainerStyle={
            podcasts.length === 0 ? styles.emptyContent : styles.listContent
          }
          refreshControl={refreshControl}
          ListEmptyComponent={EmptyState}
          alwaysBounceVertical
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function LibraryHeader({ count }: { count: number }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Library</Text>
      {count > 0 && (
        <Text style={styles.subtitle}>
          {count} {count === 1 ? "podcast" : "podcasts"}
        </Text>
      )}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>Nothing here yet.</Text>
      <Text style={styles.emptyHint}>
        Tap{" "}
        <Text style={styles.emptyHintAccent}>Generate</Text>
        {" "}to start your first podcast.
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function SkeletonList() {
  return (
    <View style={styles.listContent}>
      <View style={styles.header}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSubtitle} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i}>
          {i > 0 && <View style={styles.divider} />}
          <View style={styles.skeletonRow}>
            <View style={styles.skeletonTopic} />
            <View style={styles.skeletonStatus} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
  },
  header: {
    paddingTop: space.lg,
    paddingBottom: space.xl,
    gap: space.xs,
  },
  title: {
    ...text.displaySerif,
  },
  subtitle: {
    ...text.bodySmall,
    color: color.inkSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: color.hairline,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.xxxl,
  },
  emptyText: {
    ...text.titleSerif,
    color: color.ink,
    textAlign: "center",
  },
  emptyHint: {
    ...text.body,
    color: color.inkSecondary,
    textAlign: "center",
  },
  emptyHintAccent: {
    color: color.accent,
  },
  skeletonRow: {
    paddingVertical: space.lg,
    gap: space.sm,
  },
  skeletonTopic: {
    height: 16,
    width: "70%",
    backgroundColor: color.hairline,
    borderRadius: 1,
  },
  skeletonStatus: {
    height: 10,
    width: "30%",
    backgroundColor: color.hairline,
    borderRadius: 1,
  },
  skeletonTitle: {
    height: 32,
    width: "40%",
    backgroundColor: color.hairline,
    borderRadius: 1,
    marginBottom: space.xs,
  },
  skeletonSubtitle: {
    height: 12,
    width: "20%",
    backgroundColor: color.hairline,
    borderRadius: 1,
  },
});
