import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { usePodcasts } from "../../src/hooks/usePodcasts";
import type { Podcast } from "../../src/hooks/usePodcasts";
import {
  useUndoableDelete,
  UNDO_WINDOW_MS,
} from "../../src/hooks/useUndoableDelete";
import { PodcastRow } from "../../src/components/PodcastRow";
import { SearchField } from "../../src/components/SearchField";
import { UndoBanner } from "../../src/components/UndoBanner";
import { PodcastActionSheet } from "../../src/components/PodcastActionSheet";
import { submitPodcast } from "../../src/services/podcast";
import { color, space, text } from "../../src/theme/tokens";

const SEARCH_THRESHOLD = 8;

export default function Library() {
  const { podcasts, loading, refreshing, refresh, softDelete, restore } =
    usePodcasts();

  const [query, setQuery] = useState("");
  const [actionTarget, setActionTarget] = useState<Podcast | null>(null);

  const { pending, requestDelete, undo } = useUndoableDelete({
    softDelete,
    restore,
  });

  // Safety net for a missed realtime INSERT: when the user lands on the
  // Library tab after submitting on Generate, refetch so the new row
  // appears within one round-trip even if realtime lagged. Optimistic
  // emit (Generate → pendingPodcasts → usePodcasts) is the primary path;
  // this is belt-and-braces.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const showSearch = podcasts.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    if (!showSearch || query.trim().length === 0) return podcasts;
    const needle = query.trim().toLowerCase();
    return podcasts.filter((p) => p.topic.toLowerCase().includes(needle));
  }, [podcasts, query, showSearch]);

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

  const handleRequestDelete = (podcast: Podcast) => {
    requestDelete({ id: podcast.id, topic: podcast.topic });
  };

  // Tap on a failed row re-submits the same topic + clarifying answers.
  // On success, soft-delete the failed row so the library shows just the
  // fresh queued attempt at top. On submit failure, leave the failed row
  // visible so the user can try again or surface the error.
  const handleRetry = async (podcast: Podcast) => {
    try {
      await submitPodcast({
        topic: podcast.topic,
        clarifyingAnswers: podcast.clarifyingAnswers,
      });
      await softDelete(podcast.id);
    } catch (err) {
      console.warn("[Library] retry submit failed:", err);
    }
  };

  const handleSheetDelete = () => {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    handleRequestDelete(target);
  };

  const isSearching = showSearch && query.trim().length > 0;
  const noMatches = isSearching && filtered.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {loading ? (
        <SkeletonList />
      ) : (
        <FlatList
          style={styles.list}
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PodcastRow
              podcast={item}
              onRequestDelete={handleRequestDelete}
              onLongPress={(p) => setActionTarget(p)}
              onRetry={handleRetry}
            />
          )}
          ItemSeparatorComponent={Divider}
          ListHeaderComponent={
            <LibraryHeader
              count={podcasts.length}
              showSearch={showSearch}
              query={query}
              onChangeQuery={setQuery}
            />
          }
          contentContainerStyle={
            filtered.length === 0 && !noMatches
              ? styles.emptyContent
              : styles.listContent
          }
          refreshControl={refreshControl}
          ListEmptyComponent={noMatches ? <NoMatches query={query} /> : EmptyState}
          alwaysBounceVertical
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {pending && (
        <UndoBanner
          topic={pending.topic}
          onUndo={undo}
          durationMs={UNDO_WINDOW_MS}
        />
      )}

      <PodcastActionSheet
        visible={actionTarget !== null}
        topic={actionTarget?.topic ?? ""}
        onDelete={handleSheetDelete}
        onDismiss={() => setActionTarget(null)}
      />
    </SafeAreaView>
  );
}

interface HeaderProps {
  count: number;
  showSearch: boolean;
  query: string;
  onChangeQuery: (v: string) => void;
}

function LibraryHeader({ count, showSearch, query, onChangeQuery }: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Library</Text>
      {count > 0 && (
        <Text style={styles.subtitle}>
          {count} {count === 1 ? "podcast" : "podcasts"}
        </Text>
      )}
      {showSearch && (
        <View style={styles.searchSlot}>
          <SearchField value={query} onChangeText={onChangeQuery} />
        </View>
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

function NoMatches({ query }: { query: string }) {
  return (
    <View style={styles.noMatches}>
      <Text style={styles.noMatchesPrimary}>
        No matches for “{query.trim()}”.
      </Text>
      <Text style={styles.noMatchesHint}>Try a different word.</Text>
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
  list: {
    flex: 1,
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
  searchSlot: {
    marginTop: space.base,
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
  noMatches: {
    paddingTop: space.xxxl,
    paddingBottom: space.xxl,
    alignItems: "center",
    gap: space.xs,
  },
  noMatchesPrimary: {
    ...text.body,
    color: color.ink,
    textAlign: "center",
  },
  noMatchesHint: {
    ...text.bodySmall,
    color: color.inkSecondary,
    textAlign: "center",
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
