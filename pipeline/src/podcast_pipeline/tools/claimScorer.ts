import type { ResearchDocument } from "../nodes/research/synthesizer.js";

export interface ClaimScore {
  index: number;
  text: string;
  sourceCount: number;
  hasSpecifics: boolean; // numbers, dates, or proper nouns
}

const NUMBER_OR_DATE = /\b(\d{1,4}([./-]\d{1,4})?|\d+(\.\d+)?%?)\b/;
const PROPER_NOUN = /\b[A-Z][a-z]+(\s+[A-Z][a-z]+)*\b/;

export function scoreClaims(doc: Pick<ResearchDocument, "claims">): ClaimScore[] {
  return doc.claims.map((claim, index) => ({
    index,
    text: claim.text,
    sourceCount: claim.sourceIndexes.length,
    hasSpecifics: NUMBER_OR_DATE.test(claim.text) || PROPER_NOUN.test(claim.text),
  }));
}
