/**
 * Post-LLM sanitization for the research document.
 *
 * The synthesizer is instructed to only cite URLs the subagents actually saw,
 * but it's an LLM, so we defend in depth. After the synthesizer returns we:
 *   1. Drop any source whose URL isn't a well-formed http(s) URL.
 *   2. Drop any source whose URL didn't come back from a Tavily result
 *      during this run (the subagent could have fabricated it).
 *   3. Drop any source whose URL contains the sentinel markers we use to
 *      delimit untrusted content (paranoid; an attacker could place the
 *      marker text in a URL to confuse downstream regex).
 *
 * To preserve the prose's existing [N] markers (which the LLM bakes into the
 * section content as part of its output), dropped sources keep their slot in
 * the sources array but have their url and title blanked out. The mobile
 * renderer treats a blank url as a no-op tap (see ResearchSourceRow scheme
 * gate).
 */

import type { ResearchDocument } from "./synthesizer.js";

const MAX_URL_LENGTH = 2048;
const FORBIDDEN_MARKERS = ["<<UNTRUSTED", "<<END_UNTRUSTED"];

export interface SanitizeResult {
  document: ResearchDocument;
  droppedCount: number;
  droppedReasons: Record<string, number>;
}

function classify(url: string, seenUrls: Set<string>): string | null {
  if (typeof url !== "string" || url.length === 0) return "empty";
  if (url.length > MAX_URL_LENGTH) return "too_long";
  if (FORBIDDEN_MARKERS.some((m) => url.includes(m))) return "marker_in_url";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "malformed";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "bad_scheme";
  if (!parsed.hostname || parsed.hostname.length < 3) return "bad_host";
  if (!seenUrls.has(url)) return "not_seen";
  return null;
}

export function sanitizeResearchDocument(
  doc: ResearchDocument,
  seenUrls: Set<string>,
): SanitizeResult {
  const droppedReasons: Record<string, number> = {};
  let droppedCount = 0;

  const sources = doc.sources.map((s) => {
    const reason = classify(s.url, seenUrls);
    if (!reason) return s;
    droppedReasons[reason] = (droppedReasons[reason] ?? 0) + 1;
    droppedCount += 1;
    return { url: "", title: "(source unavailable)" };
  });

  return {
    document: { ...doc, sources },
    droppedCount,
    droppedReasons,
  };
}
