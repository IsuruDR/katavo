/**
 * Pipeline state schema — defines all data flowing through the graph.
 * Uses LangGraph.js Annotation.Root for state management.
 */

import { Annotation } from "@langchain/langgraph";

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
  researchPlan: Annotation<string>,
  researchDocument: Annotation<Record<string, unknown>>, // Structured JSONB
  sources: Annotation<Record<string, unknown>[]>, // [{url, title, snippet, credibilityScore}]
  credibilityScore: Annotation<number | null>,
  credibilityReport: Annotation<string>,
  researchIterations: Annotation<number>,

  // Script phase
  script: Annotation<string>,
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
    researchPlan: "",
    researchDocument: {},
    sources: [],
    credibilityScore: null,
    credibilityReport: "",
    researchIterations: 0,
    script: "",
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
