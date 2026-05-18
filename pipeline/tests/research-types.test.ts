import { describe, it, expect } from "vitest";
import {
  SearchResultSchema,
  SubagentTaskSchema,
  AuditedClaimSchema,
  type SubagentTask,
} from "../src/podcast_pipeline/nodes/research/types.js";

describe("research types", () => {
  it("SearchResult discriminates between snippet and fetched kinds", () => {
    const snippet = {
      url: "https://example.com",
      title: "Ex",
      kind: "tavily-snippet" as const,
      content: "short",
    };
    const fetched = {
      url: "https://example.com",
      title: "Ex",
      kind: "exa-fetched" as const,
      content: "long article",
    };
    expect(SearchResultSchema.safeParse(snippet).success).toBe(true);
    expect(SearchResultSchema.safeParse(fetched).success).toBe(true);
  });

  it("SubagentTask requires searchProvider", () => {
    const valid: SubagentTask = {
      id: "t1",
      question: "What is X?",
      context: "",
      searchHints: [],
      searchProvider: "tavily",
      maxSearches: 3,
      maxReflections: 2,
      fetchCitedUrls: true,
    };
    expect(SubagentTaskSchema.safeParse(valid).success).toBe(true);

    const missingProvider = { ...valid } as Record<string, unknown>;
    delete missingProvider.searchProvider;
    expect(SubagentTaskSchema.safeParse(missingProvider).success).toBe(false);
  });

  it("AuditedClaim carries originating source indexes", () => {
    expect(
      AuditedClaimSchema.safeParse({
        originalClaim: "X is true",
        weakness: "specificity",
        drillQuestion: "Specifically, when did X become true?",
        originatingSourceIndexes: [0, 2],
      }).success,
    ).toBe(true);
  });
});
