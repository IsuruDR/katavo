/**
 * Single source of truth for how the user-facing podcast pipeline is displayed.
 * Server-side enum: queued | researching | scripting | generating_audio | complete | failed
 * (fact_checking is in the DB enum but no longer used by the pipeline.)
 */

export type PodcastStatus =
  | "queued"
  | "researching"
  | "scripting"
  | "generating_audio"
  | "complete"
  | "failed";

interface StatusMeta {
  label: string;
  color: string;
  isWorking: boolean;
  isTerminal: boolean;
  isError: boolean;
}

export const STATUS_META: Record<string, StatusMeta> = {
  queued: { label: "Starting up", color: "#ffd43b", isWorking: true, isTerminal: false, isError: false },
  researching: { label: "Researching", color: "#ffd43b", isWorking: true, isTerminal: false, isError: false },
  scripting: { label: "Writing the script", color: "#ffd43b", isWorking: true, isTerminal: false, isError: false },
  generating_audio: { label: "Recording audio", color: "#ffd43b", isWorking: true, isTerminal: false, isError: false },
  complete: { label: "Ready", color: "#51cf66", isWorking: false, isTerminal: true, isError: false },
  failed: { label: "Failed", color: "#ff6b6b", isWorking: false, isTerminal: true, isError: true },
};

const FALLBACK: StatusMeta = {
  label: "Working",
  color: "#888",
  isWorking: true,
  isTerminal: false,
  isError: false,
};

export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? FALLBACK;
}

/**
 * Number of milestones a podcast passes through from submit to ready.
 * Four dots: Research, Script, Audio, Ready. Each integer returned is a
 * stage that has FINISHED — the current stage's dot blinks; finished
 * stages are solid.
 *
 * Queued is folded into Research because in practice it's sub-second:
 * the pipeline's briefBuilder node persists "researching" as its first
 * action, so the row leaves "queued" almost immediately. Showing it as
 * a distinct dot would just flash briefly and add noise. Queued and
 * researching share the same dot pattern; only the label distinguishes
 * them ("Starting up" vs "Researching").
 *
 * The fourth dot — Ready — fills only when status flips to "complete",
 * at which point the row exits in-flight rendering. During the audio
 * stage the user sees ● ● ◐ ○, which reads as "we're on the last work
 * stage, Ready is the next milestone."
 */
export const TOTAL_WORK_STEPS = 4;

export function getCompletedSteps(status: string): number {
  switch (status) {
    case "complete":
      return 4;
    case "generating_audio":
      return 2;
    case "scripting":
      return 1;
    case "queued":
    case "researching":
    case "fact_checking":
      return 0;
    default:
      return 0;
  }
}

/**
 * Human-readable elapsed time since the current stage began.
 * Returns null when the input timestamp isn't usable.
 */
export function formatStageDuration(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}
