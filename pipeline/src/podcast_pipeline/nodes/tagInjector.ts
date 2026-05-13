import type { RunnableConfig } from "@langchain/core/runnables";
import { getGeminiClient } from "../providers/gemini.js";
import { AUDIO_TAGS, GEMINI_TAG_INJECTOR_MODEL } from "../config.js";
import { getVoicePersonality } from "../voicePersonality.js";
import { retryTransient } from "../retry.js";
import type { PipelineStateType } from "../state.js";

const TAG_INJECTOR_RETRY_ATTEMPTS = 3; // 1 try + 3 retries = 4 attempts total
const TAG_INJECTOR_RETRY_BASE_MS = 3000; // 3s, 6s, 12s — total worst-case ~21s before fallthrough

const TAG_INJECTOR_PROMPT = (
  script: string,
  tags: readonly string[],
  voiceName: string,
  summary: string,
  scriptStyle: string,
) => `You are inserting audio tags into a podcast script that will be read aloud by an expressive TTS model (Gemini's ${voiceName} voice).

Voice context:
${summary}

${scriptStyle}

The script was written specifically for this voice. Pick tags that reinforce its feel, not fight it.

Available tags: ${tags.map((t) => `[${t}]`).join(", ")}

Take the script and insert audio tags from the list above. Place each tag immediately before the phrase or sentence it's meant to influence. Ensure the tag matches the emotional arc of the narrative. Avoid overusing tags. Place them where a natural change in tone or pace would occur. One tag per sentence maximum.

Do NOT modify the script's text, only insert bracketed tags.
Preserve all [CHAPTER: ...] markers verbatim.
Preserve any [AD:PRE_ROLL] / [AD:MID_ROLL] markers verbatim.

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
  const voiceName = state.voice ?? "Sulafat";
  const { summary, scriptStyle } = getVoicePersonality(state.voice);

  let response: { text?: string };
  try {
    response = await retryTransient(
      () =>
        client.models.generateContent({
          model: GEMINI_TAG_INJECTOR_MODEL,
          contents: TAG_INJECTOR_PROMPT(script, AUDIO_TAGS, voiceName, summary, scriptStyle),
        }) as Promise<{ text?: string }>,
      {
        retries: TAG_INJECTOR_RETRY_ATTEMPTS,
        baseDelayMs: TAG_INJECTOR_RETRY_BASE_MS,
        label: "tagInjector",
      },
    );
  } catch (err) {
    console.warn("[tagInjector] fallthrough: SDK error after retries", { error: err });
    return { taggedScript: script };
  }

  const out = response.text?.trim() ?? "";

  if (!out) {
    console.warn("[tagInjector] fallthrough: empty model output");
    return { taggedScript: script };
  }

  if (countChapterMarkers(out) !== countChapterMarkers(script)) {
    console.warn("[tagInjector] fallthrough: chapter-marker count mismatch");
    return { taggedScript: script };
  }

  return { taggedScript: out };
}
