/**
 * Splits cited prose into a sequence of plain-text and citation segments.
 *
 * Input: "Bezzera filed [1] in 1901 [2]."
 * Output:
 *   [
 *     { type: "text", value: "Bezzera filed " },
 *     { type: "citation", n: 1 },
 *     { type: "text", value: " in 1901 " },
 *     { type: "citation", n: 2 },
 *     { type: "text", value: "." },
 *   ]
 *
 * Citation numbers are 1-indexed (matching the synthesizer prompt's
 * emit format). Renderer converts to 0-indexed when looking up sources
 * via sources[n - 1].
 *
 * Edge cases:
 *   "[10]"      multi-digit accepted
 *   "[1][2]"    adjacent citations split into two segments
 *   "[0]"       invalid (synthesizer emits 1-indexed only); we still
 *               parse it as citation n=0; renderer treats out-of-range
 *               as plain text.
 *   "[abc]"     bracketed non-digit not parsed as citation; stays as
 *               plain text.
 *   "no citations" single text segment returned.
 */
export type CitationSegment =
  | { type: "text"; value: string }
  | { type: "citation"; n: number };

const CITATION_PATTERN = /\[(\d+)\]/g;

export function parseCitations(content: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_PATTERN.lastIndex = 0;
  while ((match = CITATION_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "citation", n: parseInt(match[1], 10) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments;
}
