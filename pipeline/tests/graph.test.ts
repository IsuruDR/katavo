import { describe, it, expect } from "vitest";
import { graph } from "../src/podcast_pipeline/graph.js";

describe("podcast pipeline graph", () => {
  it("should compile and run placeholder graph", async () => {
    const result = await graph.invoke({
      podcastId: "test-id",
      userId: "test-user",
      topic: "test topic",
      tier: "free",
    });
    expect(result.status).toBe("complete");
  });
});
