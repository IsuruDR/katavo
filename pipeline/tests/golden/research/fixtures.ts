import { z } from "zod";

export const GoldenFixtureSchema = z.object({
  id: z.string(),
  input: z.object({
    topic: z.string(),
    tier: z.enum(["free", "plus", "pro"]),
    clarifyingAnswers: z.array(z.record(z.string(), z.unknown())).default([]),
    parentPodcastId: z.string().nullable().optional(),
    sourceChapterTitle: z.string().nullable().optional(),
    parentResearchDocument: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  expected: z.object({
    minSectionCount: z.number(),
    minSourceCount: z.number(),
    minFetchedRatio: z.number(),
  }),
});
export type GoldenFixture = z.infer<typeof GoldenFixtureSchema>;
