import { z } from "zod";

export const SearchProviderSchema = z.enum(["tavily", "exa"]);
export type SearchProvider = z.infer<typeof SearchProviderSchema>;

export const SearchResultKindSchema = z.enum([
  "tavily-snippet",
  "tavily-fetched",
  "exa-snippet",
  "exa-fetched",
]);
export type SearchResultKind = z.infer<typeof SearchResultKindSchema>;

export const SearchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  kind: SearchResultKindSchema,
  content: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SubagentTaskSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  searchHints: z.array(z.string()),
  searchProvider: SearchProviderSchema,
  seedUrls: z.array(z.string()).optional(),
  maxSearches: z.number().int().positive(),
  maxReflections: z.number().int().nonnegative(),
  fetchCitedUrls: z.boolean(),
});
export type SubagentTask = z.infer<typeof SubagentTaskSchema>;

export const ClaimWeaknessSchema = z.enum(["specificity", "sourcing", "depth"]);
export type ClaimWeakness = z.infer<typeof ClaimWeaknessSchema>;

export const AuditedClaimSchema = z.object({
  originalClaim: z.string(),
  weakness: ClaimWeaknessSchema,
  drillQuestion: z.string(),
  originatingSourceIndexes: z.array(z.number().int().nonnegative()),
});
export type AuditedClaim = z.infer<typeof AuditedClaimSchema>;
