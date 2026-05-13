/**
 * One chapter's research block: chapter heading, cited prose
 * paragraphs (with inline ResearchCitation segments), and a
 * per-chapter Sources subsection.
 *
 * Numbering stays global. Per-chapter sources are filtered from the
 * full sources array by `sourceIndexes`, but each row renders with its
 * GLOBAL index + 1 so [3] in chapter 1's prose matches [3] in chapter
 * 1's sources subsection, and [3] in chapter 4 too if that chapter
 * also cites source index 2.
 */
import { StyleSheet, Text, View } from "react-native";
import { parseCitations } from "../lib/parseCitations";
import { ResearchCitation } from "./ResearchCitation";
import { ResearchSourceRow } from "./ResearchSourceRow";
import type { ResearchSection, ResearchSource } from "../hooks/useResearchContext";
import { color, font, space, text } from "../theme/tokens";

interface Props {
  chapterTitle: string;
  /** Sections that feed this chapter, in order. */
  sections: ResearchSection[];
  /** Full sources array; citation lookup uses global indexes. */
  sources: ResearchSource[];
  /** Global source indexes cited by this chapter, used to filter the
   *  per-chapter sources subsection. */
  citedSourceIndexes: number[];
}

export function ResearchChapterSection({
  chapterTitle,
  sections,
  sources,
  citedSourceIndexes,
}: Props) {
  const dedupedCited = Array.from(new Set(citedSourceIndexes)).sort((a, b) => a - b);

  return (
    <View style={styles.section}>
      <Text style={styles.chapterTitle}>{chapterTitle}</Text>

      {sections.map((s, i) => (
        <View key={i} style={styles.subsection}>
          {s.title ? <Text style={styles.sectionTitle}>{s.title}</Text> : null}
          <Text style={styles.body}>
            {parseCitations(s.content).map((seg, j) => {
              if (seg.type === "text") {
                return <Text key={j}>{seg.value}</Text>;
              }
              // Out-of-range citation indexes (e.g. [0] or [99] when
              // sources has 10 entries) render as plain text rather
              // than a broken green-tap-no-op affordance.
              if (seg.n < 1 || seg.n > sources.length) {
                return <Text key={j}>{` [${seg.n}]`}</Text>;
              }
              return (
                <ResearchCitation
                  key={j}
                  n={seg.n}
                  sourceUrl={sources[seg.n - 1].url}
                />
              );
            })}
          </Text>
        </View>
      ))}

      {dedupedCited.length > 0 && (
        <View style={styles.sourcesBlock}>
          <Text style={styles.sourcesEyebrow}>Sources</Text>
          {dedupedCited.map((idx) => {
            const source = sources[idx];
            if (!source) return null;
            return (
              <ResearchSourceRow
                key={idx}
                n={idx + 1}
                title={source.title}
                url={source.url}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: space.lg,
    gap: space.md,
  },
  chapterTitle: {
    ...text.titleSerif,
    fontSize: 22,
    lineHeight: 28,
    color: color.ink,
  },
  subsection: {
    gap: space.xs,
  },
  sectionTitle: {
    fontFamily: font.serifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
  },
  body: {
    ...text.body,
    color: color.ink,
    lineHeight: 24,
  },
  sourcesBlock: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: space.xxs,
  },
  sourcesEyebrow: {
    fontFamily: font.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: color.inkSecondary,
    marginBottom: space.xs,
  },
});
