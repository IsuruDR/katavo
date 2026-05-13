/**
 * Research screen, chapter-by-chapter view of the podcast's research,
 * with clickable citations and an optional Coverage gaps footer.
 *
 * Tier-gated: redirects free users to /plans on mount. Empty state
 * for podcasts without a research_contexts row (legacy, race). Error
 * state with pull-to-refresh on network failure.
 */
import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSubscription } from "../../../src/hooks/useSubscription";
import { isFeatureUnlocked } from "../../../src/lib/tiers";
import { useResearchContext } from "../../../src/hooks/useResearchContext";
import { ResearchChapterSection } from "../../../src/components/ResearchChapterSection";
import { color, font, layout, space, text } from "../../../src/theme/tokens";

export default function ResearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { subscription, loading: subLoading } = useSubscription();
  const { data, loading, error, refresh } = useResearchContext(id ?? null);

  const tier = subscription?.tier ?? "free";
  const unlocked = isFeatureUnlocked("research", tier);

  // Free deep-link redirect. Wait for subscription to load so we don't
  // bounce a paid user on the first render where tier defaults to
  // "free" before useSubscription resolves.
  useEffect(() => {
    if (subLoading) return;
    if (!unlocked) {
      const t = setTimeout(() => {
        router.replace("/plans");
      }, 600);
      return () => clearTimeout(t);
    }
  }, [unlocked, subLoading, router]);

  // Group sections by chapter using chapter_research_map. Fallback:
  // when chapterResearchMap is null, render sections flat with an
  // "Chapter mapping unavailable" eyebrow.
  const grouped = useMemo(() => {
    if (!data) return null;
    if (!data.chapterResearchMap) return null;
    return data.chapterMarkers.map((chapter) => {
      const entry = data.chapterResearchMap![chapter.title];
      if (!entry) {
        return {
          chapterTitle: chapter.title,
          sections: [],
          citedSourceIndexes: [],
        };
      }
      const sections = entry.researchSections
        .map((i) => data.researchDocument.sections[i])
        .filter(Boolean);
      return {
        chapterTitle: chapter.title,
        sections,
        citedSourceIndexes: entry.sourceIndexes,
      };
    });
  }, [data]);

  if (!unlocked) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.center}>
          <Text style={styles.message}>Research is a Plus feature.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Back to player"
        >
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={color.accent}
            colors={[color.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Research</Text>
        <Text style={styles.title}>Sources behind this episode</Text>

        {loading && !data && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={color.inkSecondary} />
          </View>
        )}

        {error && !loading && (
          <Text style={styles.error}>Couldn't load research. Pull to refresh.</Text>
        )}

        {!loading && !error && !data && (
          <Text style={styles.empty}>Research isn't available for this podcast.</Text>
        )}

        {data && grouped === null && (
          <View>
            <Text style={styles.fallbackEyebrow}>Chapter mapping unavailable</Text>
            {data.researchDocument.sections.map((s, i) => (
              <ResearchChapterSection
                key={i}
                chapterTitle={s.title ?? `Section ${i + 1}`}
                sections={[s]}
                sources={data.researchDocument.sources}
                citedSourceIndexes={[]}
              />
            ))}
          </View>
        )}

        {data && grouped && grouped.map((g, i) => (
          <ResearchChapterSection
            key={i}
            chapterTitle={g.chapterTitle}
            sections={g.sections}
            sources={data.researchDocument.sources}
            citedSourceIndexes={g.citedSourceIndexes}
          />
        ))}

        {data && data.researchDocument.droppedQuestions.length > 0 && (
          <View style={styles.gapsBlock}>
            <Text style={styles.gapsEyebrow}>Coverage gaps</Text>
            <Text style={styles.gapsLead}>
              The research didn't manage to answer:
            </Text>
            {data.researchDocument.droppedQuestions.map((q, i) => (
              <Text key={i} style={styles.gapItem}>
                {`· ${q}`}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  header: {
    flexDirection: "row",
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.base,
  },
  backLabel: {
    ...text.body,
    color: color.inkSecondary,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  eyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space.xs,
  },
  title: {
    ...text.displaySerif,
    fontSize: 26,
    lineHeight: 32,
    marginBottom: space.lg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: space.xl,
  },
  message: {
    ...text.body,
    color: color.inkSecondary,
    textAlign: "center",
  },
  loadingBlock: {
    paddingVertical: space.xxl,
    alignItems: "center",
  },
  error: {
    ...text.body,
    color: color.warning,
    paddingVertical: space.lg,
  },
  empty: {
    ...text.body,
    color: color.inkSecondary,
    paddingVertical: space.lg,
  },
  fallbackEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.sm,
  },
  gapsBlock: {
    marginTop: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: space.xs,
  },
  gapsEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.sm,
  },
  gapsLead: {
    ...text.body,
    color: color.inkSecondary,
  },
  gapItem: {
    ...text.body,
    color: color.ink,
    marginLeft: space.sm,
  },
});
