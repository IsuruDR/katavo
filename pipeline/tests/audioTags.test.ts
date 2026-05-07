import { describe, it, expect, beforeEach, vi } from "vitest";

describe("AUDIO_TAGS env-var guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back to defaults when env var is unset", async () => {
    delete process.env.AUDIO_TAGS;
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("falls back to defaults when env var is empty string", async () => {
    process.env.AUDIO_TAGS = "";
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("falls back to defaults when env var is just commas", async () => {
    process.env.AUDIO_TAGS = ",,,";
    const { AUDIO_TAGS, AUDIO_TAGS_DEFAULT } = await import(
      "../src/podcast_pipeline/config.js"
    );
    expect(AUDIO_TAGS).toEqual([...AUDIO_TAGS_DEFAULT]);
  });

  it("uses env var when populated", async () => {
    process.env.AUDIO_TAGS = "laughs,whispers";
    const { AUDIO_TAGS } = await import("../src/podcast_pipeline/config.js");
    expect(AUDIO_TAGS).toEqual(["laughs", "whispers"]);
  });
});
