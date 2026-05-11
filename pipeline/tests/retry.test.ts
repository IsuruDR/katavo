import { describe, it, expect, vi } from "vitest";
import { isTransientError, retryTransient } from "../src/podcast_pipeline/retry.js";

describe("isTransientError", () => {
  it("classifies 503 by status as transient", () => {
    expect(isTransientError({ status: 503, message: "Service Unavailable" })).toBe(true);
  });

  it("classifies 429 as transient", () => {
    expect(isTransientError({ status: 429, message: "Too Many Requests" })).toBe(true);
  });

  it("classifies 500 / 502 / 504 as transient", () => {
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 504 })).toBe(true);
  });

  it("classifies the Gemini 'high demand' message as transient even without status", () => {
    const err = new Error(
      '{"error":{"code":503,"message":"This model is currently experiencing high demand."}}',
    );
    expect(isTransientError(err)).toBe(true);
  });

  it("classifies the SDK-typical UNAVAILABLE status string as transient", () => {
    const err = new Error("status: UNAVAILABLE");
    expect(isTransientError(err)).toBe(true);
  });

  it("classifies 400/401/403/404 as NOT transient", () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 403 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
  });

  it("classifies generic non-transient errors as NOT transient", () => {
    expect(isTransientError(new Error("Invalid arguments"))).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError("plain string")).toBe(false);
  });
});

describe("retryTransient", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryTransient(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to the budget then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "high demand" })
      .mockRejectedValueOnce({ status: 503, message: "high demand" })
      .mockResolvedValueOnce("ok");
    const result = await retryTransient(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("bails out immediately on non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400, message: "Bad Request" });
    await expect(
      retryTransient(fn, { retries: 3, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after exhausting the retry budget", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503, message: "still down" });
    await expect(
      retryTransient(fn, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("emits a warn log per retry when label is set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    await retryTransient(fn, { retries: 2, baseDelayMs: 1, label: "test" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[test] transient error");
    warnSpy.mockRestore();
  });
});
