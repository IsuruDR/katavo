import type { RunnableConfig } from "@langchain/core/runnables";
import { getGeminiClient } from "../providers/gemini.js";
import { AUDIO_TAGS, GEMINI_TAG_INJECTOR_MODEL } from "../config.js";
import type { PipelineStateType } from "../state.js";

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

  try {
    const response = await client.models.generateContent({
      model: GEMINI_TAG_INJECTOR_MODEL,
      contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS),
    });

    const out = (response as { text?: string }).text?.trim() ?? "";

    if (!out) {
      console.warn("[tagInjector] fallthrough: empty model output");
      return { taggedScript: script };
    }

    if (countChapterMarkers(out) !== countChapterMarkers(script)) {
      console.warn("[tagInjector] fallthrough: chapter-marker count mismatch");
      return { taggedScript: script };
    }

    return { taggedScript: out };
  } catch (err) {
    console.warn("[tagInjector] fallthrough: SDK error", { error: err });
    return { taggedScript: script };
  }
}
