import { describe, it, expect, vi, beforeEach } from "vitest";

describe("telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.POSTHOG_API_KEY;
  });

  it("no-ops when POSTHOG_API_KEY is unset", async () => {
    const { trackEvent } = await import("../src/podcast_pipeline/providers/telemetry.js");
    expect(() => trackEvent("test_event", { foo: "bar" }, "user-1")).not.toThrow();
  });

  it("captures event when key is set", async () => {
    process.env.POSTHOG_API_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://us.i.posthog.com";
    const captureMock = vi.fn();
    vi.doMock("posthog-node", () => ({
      PostHog: vi.fn().mockImplementation(() => ({
        capture: captureMock,
        shutdown: vi.fn(),
      })),
    }));
    const { trackEvent } = await import("../src/podcast_pipeline/providers/telemetry.js");
    trackEvent("research.subagent.fetch", { provider: "exa", success: true }, "user-1");
    expect(captureMock).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "research.subagent.fetch",
      properties: { provider: "exa", success: true },
    });
  });

  it("falls back to anonymous-pipeline when distinctId is empty", async () => {
    process.env.POSTHOG_API_KEY = "phc_test";
    const captureMock = vi.fn();
    vi.doMock("posthog-node", () => ({
      PostHog: vi.fn().mockImplementation(() => ({
        capture: captureMock,
        shutdown: vi.fn(),
      })),
    }));
    const { trackEvent } = await import("../src/podcast_pipeline/providers/telemetry.js");
    trackEvent("event", { a: 1 }, "");
    expect(captureMock).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "anonymous-pipeline" }),
    );
  });
});
