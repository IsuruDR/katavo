import { describe, it, expect } from "vitest";
import {
  findRelevantSection,
  buildCoveredGroundDigest,
} from "../src/lib/parentContext.js";

const parentDoc = {
  sections: [
    { title: "Origins of espresso", content: "Bezzera filed in 1901. The lever came later." },
    { title: "Modern machines", content: "PID controllers changed the game in the 90s." },
    { title: "Specialty wave", content: "Third wave coffee shops emerged around 2002." },
  ],
};

describe("findRelevantSection", () => {
  it("matches by case-insensitive substring", () => {
    const match = findRelevantSection("origins", parentDoc.sections);
    expect(match.section?.title).toBe("Origins of espresso");
    expect(match.matchKind).toBe("substring");
  });

  it("falls back to keyword overlap when no substring match", () => {
    const match = findRelevantSection("third-wave specialty cafes", parentDoc.sections);
    expect(match.section?.title).toBe("Specialty wave");
    expect(match.matchKind).toBe("overlap");
  });

  it("falls back to first section + fallback marker when no match", () => {
    const match = findRelevantSection("completely unrelated topic xyzzy", parentDoc.sections);
    expect(match.section?.title).toBe("Origins of espresso");
    expect(match.matchKind).toBe("fallback");
  });

  it("returns null section when sections list is empty", () => {
    const match = findRelevantSection("anything", []);
    expect(match.section).toBeNull();
    expect(match.matchKind).toBe("none");
  });
});

describe("buildCoveredGroundDigest", () => {
  it("excludes the matched section", () => {
    const digest = buildCoveredGroundDigest(parentDoc, 0);
    expect(digest).not.toContain("Origins");
    expect(digest).toContain("Modern machines");
    expect(digest).toContain("Specialty wave");
  });

  it("respects char cap by dropping later sections first", () => {
    const longDoc = {
      sections: Array.from({ length: 20 }, (_, i) => ({
        title: `Section ${i}`,
        content: "x".repeat(500),
      })),
    };
    const digest = buildCoveredGroundDigest(longDoc, 0);
    expect(digest.length).toBeLessThanOrEqual(3_200);
    expect(digest).toContain("Section 1");
    // Section 19 should be dropped (later position)
    expect(digest).not.toContain("Section 19");
  });

  it("returns placeholder when no other sections exist", () => {
    const digest = buildCoveredGroundDigest({ sections: [parentDoc.sections[0]] }, 0);
    expect(digest).toContain("no other parent sections");
  });
});
