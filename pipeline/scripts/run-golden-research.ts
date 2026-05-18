import "dotenv/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { graph } from "../src/podcast_pipeline/graph.js";
import { makeInitialState } from "../src/podcast_pipeline/state.js";
import { GoldenFixtureSchema } from "../tests/golden/research/fixtures.js";

async function main() {
  process.env.RESEARCH_V12_ASYMMETRIC = "1";
  const goldenDir = "tests/golden/research";
  const files = (await readdir(goldenDir)).filter(
    (f) => f.endsWith(".json") && !f.startsWith("last-run-"),
  );

  for (const file of files) {
    const raw = await readFile(join(goldenDir, file), "utf-8");
    const fixture = GoldenFixtureSchema.parse(JSON.parse(raw));
    console.log(`\n=== ${fixture.id} ===`);
    const state = makeInitialState({
      podcastId: `golden-${fixture.id}-${Date.now()}`,
      userId: "golden-runner",
      topic: fixture.input.topic,
      clarifyingAnswers: fixture.input.clarifyingAnswers,
      tier: fixture.input.tier,
      parentPodcastId: fixture.input.parentPodcastId ?? null,
      sourceChapterTitle: fixture.input.sourceChapterTitle ?? null,
      parentResearchDocument: fixture.input.parentResearchDocument ?? null,
    });
    const result = await graph.invoke(state);
    const doc = result.researchDocument as any;
    const sources = (result.sources as any[]) ?? [];
    const fetchedCount = sources.filter((s: any) => s.kind?.endsWith?.("-fetched")).length;
    const fetchedRatio = sources.length === 0 ? 0 : fetchedCount / sources.length;
    const report = {
      id: fixture.id,
      status: result.status,
      sectionCount: doc?.sections?.length ?? 0,
      sourceCount: sources.length,
      fetchedRatio,
      passed:
        (doc?.sections?.length ?? 0) >= fixture.expected.minSectionCount &&
        sources.length >= fixture.expected.minSourceCount &&
        fetchedRatio >= fixture.expected.minFetchedRatio,
    };
    console.log(JSON.stringify(report, null, 2));
    await writeFile(
      join(goldenDir, `last-run-${fixture.id}.json`),
      JSON.stringify({ report, doc }, null, 2),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
