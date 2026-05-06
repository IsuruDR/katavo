import { describe, it, expect } from "vitest";

const RUN_LIVE_RESEARCH = process.env.RUN_LIVE_RESEARCH === "1";

describe.skipIf(!RUN_LIVE_RESEARCH)("deepResearchAgent (live, gated)", () => {
  it(
    "produces a valid research_document for the smoke topic",
    async () => {
      const { deepResearchAgent } = await import(
        "../../src/podcast_pipeline/nodes/deepResearchAgent.js"
      );
      const topic = process.env.SMOKE_TOPIC ?? "history of espresso machines";
      // N=4 keyQuestions intentionally — floor for N=4 is 3, so the test tolerates
      // one dropped subagent (real Tavily flakiness). N=3 would require all to
      // succeed and turn every gated $0.20 run into a coin flip.
      const brief =
        process.env.SMOKE_BRIEF ??
        JSON.stringify({
          scope: "Origins and evolution of espresso machines from 1900 to today",
          angle: "engaging history with key inventors and technical milestones",
          depth: "intermediate",
          keyQuestions: [
            "Who invented the first espresso machine?",
            "What were the major technical milestones in espresso machine evolution?",
            "Which manufacturers shaped the modern espresso market?",
            "How did espresso culture spread beyond Italy?",
          ],
        });
      const state = {
        podcastId: "test-live",
        topic,
        researchBrief: brief,
        tier: "pro",
        researchIterations: 0,
        hasAds: false,
        trustedSourceUrls: [],
      } as any;

      const result = await deepResearchAgent(state);
      expect(result.status).toBe("scripting");
      expect(result.researchDocument).toBeDefined();
      const doc = result.researchDocument as any;
      expect(doc.sections.length).toBeGreaterThanOrEqual(3);
      expect(doc.sources.length).toBeGreaterThan(0);
      expect(doc.claims.length).toBeGreaterThan(0);
      expect(result.credibilityScore).toBeGreaterThan(0.5);
    },
    5 * 60_000,
  ); // 5 min wallclock
});
