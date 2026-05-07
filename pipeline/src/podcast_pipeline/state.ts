/**
 * Pipeline state schema — defines all data flowing through the graph.
 * Uses LangGraph.js Annotation.Root for state management.
 */

import { Annotation } from "@langchain/langgraph";

/** Per-chapter mapping to research sections and source indexes */
export interface ChapterResearchEntry {
  researchSections: number[];
  sourceIndexes: number[];
}

export type ChapterResearchMap = Record<string, ChapterResearchEntry> | null;

export const PipelineState = Annotation.Root({
  // Input (set at pipeline start)
  podcastId: Annotation<string>,
  userId: Annotation<string>,
  topic: Annotation<string>,
  clarifyingAnswers: Annotation<Record<string, unknown>[]>,
  hasAds: Annotation<boolean>,
  trustedSourceUrls: Annotation<string[]>,
  tier: Annotation<string>, // "free", "plus", "pro"

  // Research phase
  researchBrief: Annotation<string>,
  researchDocument: Annotation<Record<string, unknown>>, // Structured JSONB
  sources: Annotation<Record<string, unknown>[]>, // [{url, title}]
  rawResearchResponse: Annotation<Record<string, unknown> | null>, // Full Deep Research response (output[], usage, status, ...)
  credibilityScore: Annotation<number | null>,
  credibilityReport: Annotation<string>,
  researchIterations: Annotation<number>,
  voice: Annotation<string | null>,

  // Script phase
  script: Annotation<string>,
  taggedScript: Annotation<string>,
  chapterResearchMap: Annotation<ChapterResearchMap>,
  adMarkers: Annotation<Record<string, number> | null>, // {preRoll: seconds, midRoll: seconds}

  // Audio phase
  audioUrl: Annotation<string>,
  transcript: Annotation<string>,
  chapterMarkers: Annotation<Record<string, unknown>[]>, // [{timestampSeconds, title}]
  durationSeconds: Annotation<number>,

  // Status
  status: Annotation<string>,
  errorMessage: Annotation<string | null>,

  // Quality gate routing
  shouldRetry: Annotation<boolean>,
  needsDisclaimer: Annotation<boolean>,
});

export type PipelineStateType = typeof PipelineState.State;

/** Default values for a new state */
export function makeInitialState(overrides: Partial<PipelineStateType>): PipelineStateType {
  const defaults: PipelineStateType = {
    podcastId: "",
    userId: "",
    topic: "",
    clarifyingAnswers: [],
    hasAds: false,
    trustedSourceUrls: [],
    tier: "free",
    researchBrief: "",
    researchDocument: {},
    sources: [],
    rawResearchResponse: null,
    credibilityScore: null,
    credibilityReport: "",
    researchIterations: 0,
    voice: null,
    script: "",
    taggedScript: "",
    chapterResearchMap: null,
    adMarkers: null,
    audioUrl: "",
    transcript: "",
    chapterMarkers: [],
    durationSeconds: 0,
    status: "queued",
    errorMessage: null,
    shouldRetry: false,
    needsDisclaimer: false,
  };
  return { ...defaults, ...overrides };
}
