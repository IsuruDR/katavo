/**
 * Inserts ad placement markers into the script for free-tier podcasts.
 */

import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../config.js";
import type { PipelineStateType } from "../state.js";

export function adInjector(
  state: PipelineStateType,
): Partial<PipelineStateType> {
  let { script } = state;
  const hasAds = state.hasAds ?? false;

  if (!hasAds) {
    return { script };
  }

  // Insert pre-roll at the very beginning
  script = `${AD_PRE_ROLL_MARKER}\n\n${script}`;

  // Insert mid-roll at the second chapter break (natural midpoint)
  const chapterPattern = /\[CHAPTER:/g;
  const chapterPositions: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = chapterPattern.exec(script)) !== null) {
    chapterPositions.push(match.index);
  }

  if (chapterPositions.length >= 3) {
    const midPos = chapterPositions[2];
    script = script.slice(0, midPos) + `\n${AD_MID_ROLL_MARKER}\n\n` + script.slice(midPos);
  } else if (chapterPositions.length >= 2) {
    const midPos = chapterPositions[1];
    script = script.slice(0, midPos) + `\n${AD_MID_ROLL_MARKER}\n\n` + script.slice(midPos);
  }

  return { script };
}
