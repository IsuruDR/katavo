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
