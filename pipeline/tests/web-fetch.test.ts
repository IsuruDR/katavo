import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WEB_FETCH_MAX_CHARS_PER_URL,
  WEB_FETCH_MIN_EXTRACT_CHARS,
} from "../src/podcast_pipeline/config.js";

const fetchMock = vi.hoisted(() => vi.fn());
const readabilityMock = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    parse: () => ({ textContent: "long article body ".repeat(100) }),
  })),
);

globalThis.fetch = fetchMock as any;

vi.mock("@mozilla/readability", () => ({
  Readability: readabilityMock,
}));
vi.mock("jsdom", () => ({
  JSDOM: vi.fn().mockImplementation(() => ({
    window: { document: {} },
  })),
}));

describe("webFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    readabilityMock.mockClear();
    // Default behavior — tests override as needed
    readabilityMock.mockImplementation(() => ({
      parse: () => ({ textContent: "long article body ".repeat(100) }),
    }));
  });

  it("returns fetched content on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>article</body></html>",
    });
    const { fetchAndExtract } = await import("../src/podcast_pipeline/tools/webFetch.js");
    const result = await fetchAndExtract("https://example.com/article");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content.length).toBeGreaterThan(WEB_FETCH_MIN_EXTRACT_CHARS);
      expect(result.content.length).toBeLessThanOrEqual(WEB_FETCH_MAX_CHARS_PER_URL);
    }
  });

  it("treats 404 as failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" });
    const { fetchAndExtract } = await import("../src/podcast_pipeline/tools/webFetch.js");
    const result = await fetchAndExtract("https://example.com/missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("http_error");
  });

  it("detects paywall (200 status but tiny extract)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>paywall</body></html>",
    });
    readabilityMock.mockImplementationOnce(() => ({
      parse: () => ({ textContent: "Sign in" }),
    }));
    const { fetchAndExtract } = await import("../src/podcast_pipeline/tools/webFetch.js");
    const result = await fetchAndExtract("https://nyt.com/article");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("paywall_or_thin");
  });

  it("times out when fetch hangs past WEB_FETCH_TIMEOUT_MS", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const { fetchAndExtract } = await import("../src/podcast_pipeline/tools/webFetch.js");
    const result = await fetchAndExtract("https://slow.com");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("timeout");
  }, 15_000);
});
