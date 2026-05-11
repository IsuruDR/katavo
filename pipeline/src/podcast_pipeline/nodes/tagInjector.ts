import type { RunnableConfig } from "@langchain/core/runnables";
import { getGeminiClient } from "../providers/gemini.js";
import { AUDIO_TAGS, GEMINI_TAG_INJECTOR_MODEL } from "../config.js";
import type { PipelineStateType } from "../state.js";

const TAG_INJECTOR_RETRY_ATTEMPTS = 3; // 1 try + 3 retries = 4 attempts total
const TAG_INJECTOR_RETRY_BASE_MS = 3000; // 3s, 6s, 12s — total worst-case ~21s before fallthrough

// Transient errors worth retrying — 429 (rate limit), 5xx, and any error
// whose message hints at the high-demand condition we keep hitting.
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (typeof e.status === "number" && (e.status === 429 || e.status >= 500)) {
    return true;
  }
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded")
  );
}

const TAG_INJECTOR_PROMPT = (script: string, tags: readonly string[]) => `
You are inserting audio tags into a podcast script that will be read aloud
by an expressive TTS model. Without tags the delivery sounds flat; your
job is to give it the texture of a real person talking — small breaths,
beats of thought, the occasional aside.

Available tags: ${tags.map((t) => `[${t}]`).join(", ")}

Density target (lean denser, not sparser):
- Roughly one tag per 2-3 sentences in conversational passages, asides,
  reactions, and chapter transitions.
- Roughly one tag per 3-4 sentences in dense factual passages (citing
  data, walking through a mechanism) — still tagged, just less.
- Every chapter opening lands at least one tag in its first 1-2
  sentences to set tone. Every chapter closing benefits from
  [pauses] or [thoughtful] on the final beat to let it land.
- Better to err one tag too many than one too few. A reader skimming
  the script should see tags on most paragraphs.

Tag-selection rules:
- Use the delivery tags ([pauses], [exhales], [chuckles], [thoughtful],
  [curious], [serious]) freely — they sound natural and add subtle
  pacing without drawing attention.
- Reserve the strong-emotion tags ([laughs], [surprised], [whispers],
  [sighs]) for genuine moments where the sentence actually warrants it.
  Don't stack [laughs] on every joke or [surprised] on every fact.
- Insert the tag immediately before the phrase or sentence it influences
  (e.g., "[chuckles] You'd think they'd have figured it out by then.").
- One tag per sentence maximum. Never double-tag.

Hard constraints:
- Do NOT modify the script's text — only insert bracketed tags.
- Preserve all [CHAPTER: ...] markers verbatim.
- Preserve any [AD:PRE_ROLL] / [AD:MID_ROLL] markers verbatim.

Script:
${script}
`;

function countChapterMarkers(s: string): number {
  return (s.match(/\[CHAPTER:/g) ?? []).length;
}

export async function tagInjector(
  state: PipelineStateType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config?: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const script = state.script;
  if (!script) {
    console.warn("[tagInjector] no script in state — skipping");
    return { taggedScript: "" };
  }

  const client = getGeminiClient();

  let lastErr: unknown;
  for (let attempt = 0; attempt <= TAG_INJECTOR_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: GEMINI_TAG_INJECTOR_MODEL,
        contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS),
      });

      const out = (response as { text?: string }).text?.trim() ?? "";

      if (!out) {
        // Non-transient validation failure — don't retry, just fall through.
        console.warn("[tagInjector] fallthrough: empty model output");
        return { taggedScript: script };
      }

      if (countChapterMarkers(out) !== countChapterMarkers(script)) {
        console.warn("[tagInjector] fallthrough: chapter-marker count mismatch");
        return { taggedScript: script };
      }

      return { taggedScript: out };
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      if (transient && attempt < TAG_INJECTOR_RETRY_ATTEMPTS) {
        const delayMs = TAG_INJECTOR_RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `[tagInjector] transient error (attempt ${attempt + 1}/${TAG_INJECTOR_RETRY_ATTEMPTS + 1}), retrying in ${delayMs}ms`,
          { error: err },
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      // Non-transient or out of retries — bail out and fall through.
      break;
    }
  }

  console.warn("[tagInjector] fallthrough: SDK error after retries", { error: lastErr });
  return { taggedScript: script };
}
