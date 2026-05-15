import { describe, it, expect } from "vitest";
import { sanitizeResearchDocument } from "../src/podcast_pipeline/nodes/research/sanitize.js";
import type { ResearchDocument } from "../src/podcast_pipeline/nodes/research/synthesizer.js";

function doc(sources: Array<{ url: string; title: string }>): ResearchDocument {
  return {
    sections: [{ title: "T", content: "x" }],
    sources,
    claims: [{ text: "c", sourceIndexes: [0] }],
    droppedQuestions: [],
  };
}

describe("sanitizeResearchDocument", () => {
  it("keeps well-formed https sources that were seen during Tavily search", () => {
    const seen = new Set(["https://example.com/a", "https://other.org/b"]);
    const result = sanitizeResearchDocument(
      doc([
        { url: "https://example.com/a", title: "A" },
        { url: "https://other.org/b", title: "B" },
      ]),
      seen,
    );
    expect(result.droppedCount).toBe(0);
    expect(result.document.sources).toHaveLength(2);
    expect(result.document.sources[0].url).toBe("https://example.com/a");
  });

  it("blanks URL+title for sources the subagents never saw (fabricated URLs)", () => {
    const seen = new Set(["https://example.com/a"]);
    const result = sanitizeResearchDocument(
      doc([
        { url: "https://example.com/a", title: "A" },
        { url: "https://phish.example/login", title: "Fake" },
      ]),
      seen,
    );
    expect(result.droppedCount).toBe(1);
    expect(result.droppedReasons.not_seen).toBe(1);
    expect(result.document.sources[1].url).toBe("");
    expect(result.document.sources[1].title).toBe("(source unavailable)");
    // Index preservation: the kept source stays at index 0
    expect(result.document.sources[0].url).toBe("https://example.com/a");
  });

  it("drops non-http(s) schemes regardless of seen-set", () => {
    const seen = new Set(["tel:+1-900-555-1234"]);
    const result = sanitizeResearchDocument(
      doc([{ url: "tel:+1-900-555-1234", title: "Phone" }]),
      seen,
    );
    expect(result.droppedCount).toBe(1);
    expect(result.droppedReasons.bad_scheme).toBe(1);
    expect(result.document.sources[0].url).toBe("");
  });

  it("drops malformed URLs", () => {
    const seen = new Set(["not a url"]);
    const result = sanitizeResearchDocument(doc([{ url: "not a url", title: "x" }]), seen);
    expect(result.droppedReasons.malformed).toBe(1);
  });

  it("drops URLs containing the untrusted-content marker (paranoia)", () => {
    const url = "https://example.com/<<UNTRUSTED_WEB_CONTENT";
    const seen = new Set([url]);
    const result = sanitizeResearchDocument(doc([{ url, title: "x" }]), seen);
    expect(result.droppedReasons.marker_in_url).toBe(1);
  });

  it("drops overly long URLs", () => {
    const url = "https://example.com/" + "a".repeat(3000);
    const seen = new Set([url]);
    const result = sanitizeResearchDocument(doc([{ url, title: "x" }]), seen);
    expect(result.droppedReasons.too_long).toBe(1);
  });

  it("drops empty URLs and replaces title", () => {
    const seen = new Set<string>();
    const result = sanitizeResearchDocument(doc([{ url: "", title: "x" }]), seen);
    expect(result.droppedReasons.empty).toBe(1);
    expect(result.document.sources[0].title).toBe("(source unavailable)");
  });

  it("preserves sections, claims, and droppedQuestions verbatim", () => {
    const seen = new Set(["https://example.com/a"]);
    const input = doc([{ url: "https://example.com/a", title: "A" }]);
    input.sections = [{ title: "Section 1", content: "Content with [1] marker." }];
    input.claims = [{ text: "Earth is round.", sourceIndexes: [0] }];
    input.droppedQuestions = ["Q I couldn't answer"];
    const result = sanitizeResearchDocument(input, seen);
    expect(result.document.sections).toEqual(input.sections);
    expect(result.document.claims).toEqual(input.claims);
    expect(result.document.droppedQuestions).toEqual(input.droppedQuestions);
  });
});
