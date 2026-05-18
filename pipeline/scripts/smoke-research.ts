import "dotenv/config";
import { graph } from "../src/podcast_pipeline/graph.js";
import { makeInitialState } from "../src/podcast_pipeline/state.js";

async function main() {
  const topic = process.argv[2] ?? "the history of espresso machines";
  const isExpansion = process.argv[3] === "--expansion";

  process.env.RESEARCH_V12_ASYMMETRIC = "1";

  const state = makeInitialState({
    podcastId: `smoke-${Date.now()}`,
    userId: "smoke-user",
    topic,
    clarifyingAnswers: [],
    tier: "pro",
    parentPodcastId: isExpansion ? "smoke-parent" : null,
    sourceChapterTitle: isExpansion ? "Origins" : null,
    parentResearchDocument: isExpansion
      ? { sections: [{ title: "Origins", content: "Bezzera filed in 1901." }] }
      : null,
  });

  const result = await graph.invoke(state);
  console.log("=== RESULT ===");
  console.log("Status:", result.status);
  console.log("Sections:", (result.researchDocument as any)?.sections?.length ?? 0);
  console.log("Sources:", result.sources?.length ?? 0);
  console.log("Sample section:");
  console.log(JSON.stringify((result.researchDocument as any)?.sections?.[0], null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
