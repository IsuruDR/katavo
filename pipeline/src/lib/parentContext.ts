/**
 * Shared helpers for resolving a parent podcast's context.
 *
 * Used by submitPodcast (initial enqueue) and recoverStuckJobs (recovery
 * enqueue) so both code paths produce identical pipeline state for expansions.
 */

export interface ParentContext {
  topic: string;
  chapter_markers: Array<{ timestampSeconds: number; title: string }>;
  chapter_transcripts: Record<string, string> | null;
  research_document: Record<string, unknown>;
}

/**
 * Fetches parent podcast context needed to enqueue an expansion pipeline run.
 * Returns null if the parent doesn't exist, is deleted, or is owned by a
 * different user.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchParentContext(
  serviceClient: any,
  parentId: string,
  userId: string,
): Promise<ParentContext | null> {
  const { data, error } = (await serviceClient
    .from("podcasts")
    .select(
      "user_id, topic, chapter_markers, chapter_transcripts, research_contexts(research_document)",
    )
    .eq("id", parentId)
    .is("deleted_at", null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .single()) as { data: any; error: any };
  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  const researchDoc =
    (Array.isArray(data.research_contexts)
      ? data.research_contexts[0]?.research_document
      : data.research_contexts?.research_document) ?? {};
  return {
    topic: data.topic,
    chapter_markers: data.chapter_markers ?? [],
    chapter_transcripts: data.chapter_transcripts ?? null,
    research_document: researchDoc,
  };
}

/**
 * Builds a compact digest of the parent's research document for injection
 * into the child podcast's pipeline state. Each section is one bullet — title
 * plus the first sentence of content (capped at 240 chars).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildResearchDigest(researchDocument: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections = (researchDocument as any).sections;
  if (!Array.isArray(sections) || sections.length === 0)
    return "(no parent research available)";
  return sections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => {
      const title = String(s.title ?? "");
      const firstSentence = String(s.content ?? "")
        .split(/(?<=[.!?])\s/)[0]
        .slice(0, 240);
      return `- ${title}: ${firstSentence}`;
    })
    .join("\n");
}

// v22 — chapter section finder + covered-ground digest for the depth pipeline
import { COVERED_GROUND_DIGEST_MAX_CHARS } from "../podcast_pipeline/config.js";

export interface ParentSection {
  title: string;
  content: string;
}

export interface SectionMatch {
  section: ParentSection | null;
  matchedIndex: number;
  matchKind: "substring" | "overlap" | "fallback" | "none";
}

const TOKEN_SPLIT = /[\s\-_,.;:!?()\[\]"']+/;
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "but",
  "is", "are", "was", "were", "be", "with", "by", "as", "at", "it",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function findRelevantSection(
  chapterTitle: string,
  sections: ParentSection[],
): SectionMatch {
  if (sections.length === 0) {
    return { section: null, matchedIndex: -1, matchKind: "none" };
  }
  const lowerChapter = chapterTitle.toLowerCase();

  // 1. Case-insensitive substring match (either direction)
  for (let i = 0; i < sections.length; i++) {
    const lowerTitle = sections[i].title.toLowerCase();
    if (lowerChapter.includes(lowerTitle) || lowerTitle.includes(lowerChapter)) {
      return { section: sections[i], matchedIndex: i, matchKind: "substring" };
    }
  }

  // 2. Keyword overlap, threshold 0.3
  const chapterTokens = new Set(tokenize(chapterTitle));
  if (chapterTokens.size === 0) {
    return { section: sections[0], matchedIndex: 0, matchKind: "fallback" };
  }
  let bestScore = 0;
  let bestIndex = -1;
  for (let i = 0; i < sections.length; i++) {
    const sectionTokens = new Set(tokenize(sections[i].title));
    if (sectionTokens.size === 0) continue;
    let overlap = 0;
    for (const t of chapterTokens) if (sectionTokens.has(t)) overlap++;
    const score = overlap / Math.max(chapterTokens.size, sectionTokens.size);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestScore >= 0.3 && bestIndex >= 0) {
    return { section: sections[bestIndex], matchedIndex: bestIndex, matchKind: "overlap" };
  }

  // 3. Fallback to first section
  return { section: sections[0], matchedIndex: 0, matchKind: "fallback" };
}

export function buildCoveredGroundDigest(
  researchDocument: Record<string, unknown>,
  excludeSectionIndex: number,
): string {
  const sections = (researchDocument as { sections?: ParentSection[] }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return "(no parent research available)";
  }
  const other = sections
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.index !== excludeSectionIndex);
  if (other.length === 0) {
    return "(no other parent sections covered)";
  }
  const bullets = other.map((s) => {
    const firstSentence = (s.content ?? "")
      .split(/(?<=[.!?])\s/)[0]
      .slice(0, 240);
    return `- ${s.title}: ${firstSentence}`;
  });
  let out = bullets.join("\n");
  while (out.length > COVERED_GROUND_DIGEST_MAX_CHARS && bullets.length > 1) {
    bullets.pop();
    out = bullets.join("\n");
  }
  return out;
}
