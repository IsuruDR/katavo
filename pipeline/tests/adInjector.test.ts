import { describe, it, expect } from "vitest";
import { adInjector } from "../src/podcast_pipeline/nodes/adInjector.js";
import { AD_PRE_ROLL_MARKER, AD_MID_ROLL_MARKER } from "../src/podcast_pipeline/config.js";

describe("adInjector", () => {
  it("should insert markers for free tier", () => {
    const state = {
      script:
        "[CHAPTER: Intro]\nHello world\n\n[CHAPTER: Main]\nContent here\n\n[CHAPTER: End]\nGoodbye",
      hasAds: true,
    };

    const result = adInjector(state as any);

    expect(result.script).toContain(AD_PRE_ROLL_MARKER);
    expect(result.script).toContain(AD_MID_ROLL_MARKER);
  });

  it("should skip ad markers for paid tier", () => {
    const state = {
      script: "[CHAPTER: Intro]\nHello world",
      hasAds: false,
    };

    const result = adInjector(state as any);

    expect(result.script).not.toContain(AD_PRE_ROLL_MARKER);
    expect(result.script).not.toContain(AD_MID_ROLL_MARKER);
  });
});
