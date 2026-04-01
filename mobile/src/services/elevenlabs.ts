// mobile/src/services/elevenlabs.ts
/**
 * ElevenLabs Conversational AI service.
 * Handles agent configuration and context preparation.
 *
 * The actual conversation lifecycle is managed by the `useConversation` hook
 * from `@elevenlabs/react-native`, used in the `useDeepDive` hook.
 */

const ELEVENLABS_AGENT_ID = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID ?? "";
const MAX_CONTEXT_TOKENS = 8000;

interface ResearchSection {
  title: string;
  content: string;
}

interface Source {
  url: string;
  title: string;
}

interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

interface DeepDiveContext {
  researchDocument: { sections?: ResearchSection[] };
  sources: Source[];
  chapterResearchMap: Record<string, ChapterResearchEntry> | null;
  transcript: string;
  chapterTitle: string;
}

/**
 * Estimate token count (rough: 1 token ~ 4 chars).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the contextual update text to send to the ElevenLabs agent
 * via `conversation.sendContextualUpdate()`.
 *
 * This replaces the old approach of passing overrides at session start.
 * The agent receives this as grounding context for the conversation.
 */
export function buildAgentContext(context: DeepDiveContext): {
  contextualUpdate: string;
  firstMessage: string;
} {
  const { researchDocument, sources, chapterResearchMap, transcript, chapterTitle } =
    context;

  const sections = researchDocument.sections ?? [];
  const chapterEntry = chapterResearchMap?.[chapterTitle];

  // Identify priority sections for this chapter
  const prioritySectionIndexes = new Set(chapterEntry?.researchSections ?? []);
  const prioritySourceIndexes = new Set(chapterEntry?.sourceIndexes ?? []);

  // Build research context with priority sections first
  let researchText = "";
  const prioritySections: string[] = [];
  const otherSections: string[] = [];

  sections.forEach((section, i) => {
    const text = `## ${section.title}\n${section.content}`;
    if (prioritySectionIndexes.has(i)) {
      prioritySections.push(text);
    } else {
      otherSections.push(text);
    }
  });

  researchText = [...prioritySections, ...otherSections].join("\n\n");

  // Truncate if exceeding token limit
  if (estimateTokens(researchText) > MAX_CONTEXT_TOKENS) {
    // Keep priority sections, truncate others
    const priorityText = prioritySections.join("\n\n");
    const remainingTokens = MAX_CONTEXT_TOKENS - estimateTokens(priorityText) - 200;

    if (remainingTokens > 0) {
      const otherText = otherSections.join("\n\n");
      const truncatedOther = otherText.slice(0, remainingTokens * 4);
      researchText = `${priorityText}\n\n${truncatedOther}...\n[Remaining sections truncated for context limits]`;
    } else {
      researchText = priorityText;
    }
  }

  // Build source citations text
  const sourceText = sources
    .map((s, i) => {
      const marker = prioritySourceIndexes.has(i) ? " [CHAPTER SOURCE]" : "";
      return `[${i + 1}] ${s.title}: ${s.url}${marker}`;
    })
    .join("\n");

  const contextualUpdate = `You are a researcher who produced a podcast episode. The listener wants to go deeper on the chapter "${chapterTitle}".

Draw from the full research below, especially the sections marked as priority for this chapter. Cite sources by number when relevant. Be conversational, clear, and thorough.

If the listener asks about something outside the research, say so honestly rather than speculating.

---
RESEARCH DOCUMENT:
${researchText}

---
SOURCES:
${sourceText}

---
PODCAST TRANSCRIPT (for reference):
${transcript.slice(0, 2000)}${transcript.length > 2000 ? "..." : ""}`;

  const firstMessage = `Hey! I see you're diving deeper into "${chapterTitle}". What would you like to explore?`;

  return { contextualUpdate, firstMessage };
}

/**
 * Get the ElevenLabs agent ID for configuration.
 */
export function getAgentId(): string {
  return ELEVENLABS_AGENT_ID;
}
