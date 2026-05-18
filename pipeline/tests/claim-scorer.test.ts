import { describe, it, expect } from "vitest";
import { scoreClaims } from "../src/podcast_pipeline/tools/claimScorer.js";

const docFixture = {
  sections: [{ title: "Origins", content: "Bezzera filed his patent in 1901, a Tuesday morning." }],
  sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }],
  claims: [
    { text: "Bezzera filed his patent in 1901", sourceIndexes: [0, 1] },
    { text: "things matter sometimes", sourceIndexes: [] }, // no caps, no numbers
    { text: "There's a number that matters", sourceIndexes: [0] },
  ],
};

describe("scoreClaims", () => {
  it("flags claims with no sources", () => {
    const scored = scoreClaims(docFixture);
    expect(scored[1].sourceCount).toBe(0);
  });

  it("flags vague claims (no numbers, dates, or proper nouns)", () => {
    const scored = scoreClaims(docFixture);
    // "things matter sometimes" has no numbers/dates/proper nouns → false
    expect(scored[1].hasSpecifics).toBe(false);
    // "Bezzera filed his patent in 1901" has both → true
    expect(scored[0].hasSpecifics).toBe(true);
    // "There's a number that matters" matches no number regex but has "There's" (proper noun start)
    // — covered by either regex, treated as specific
    expect(scored[2].hasSpecifics).toBe(true);
  });

  it("preserves claim index", () => {
    const scored = scoreClaims(docFixture);
    expect(scored.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});
