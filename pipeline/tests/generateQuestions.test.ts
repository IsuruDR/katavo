import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchWithRateLimitRetry,
  extractQuestions,
} from "../src/routes/generateQuestions.js";

const buildResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("fetchWithRateLimitRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the first response when status is not 429", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(buildResponse(200, { ok: true }));

    const res = await fetchWithRateLimitRetry("https://api.x", {
      method: "POST",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("retries on 429 honoring Retry-After header and succeeds on the next call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        buildResponse(429, { error: { message: "rate" } }, { "retry-after": "1" }),
      )
      .mockResolvedValueOnce(buildResponse(200, { ok: true }));

    const promise = fetchWithRateLimitRetry("https://api.x", { method: "POST" });

    // 1s + 500ms buffer = 1500ms wait scheduled.
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("falls back to default wait when Retry-After is absent", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(buildResponse(429, { error: { message: "rate" } }))
      .mockResolvedValueOnce(buildResponse(200, { ok: true }));

    const promise = fetchWithRateLimitRetry("https://api.x", { method: "POST" });
    // Default 1000 + 500 buffer.
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("gives up after exhausting retries and returns the final 429", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        buildResponse(429, { error: { message: "rate" } }, { "retry-after": "0" }),
      );

    const promise = fetchWithRateLimitRetry("https://api.x", { method: "POST" });
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await promise;

    // 1 initial + 2 retries = 3 calls.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(429);
  });

  it("does not retry on 5xx errors", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(buildResponse(500, { error: "boom" }));

    const res = await fetchWithRateLimitRetry("https://api.x", { method: "POST" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });

  it("propagates network errors without retry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(
      fetchWithRateLimitRetry("https://api.x", { method: "POST" }),
    ).rejects.toThrow("ECONNRESET");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("extractQuestions", () => {
  const qs = ["What angle?", "How deep?", "Any people?"];

  it("accepts the canonical shape { questions: string[] } as a string", () => {
    expect(extractQuestions(JSON.stringify({ questions: qs }))).toEqual(qs);
  });

  it("accepts already-parsed canonical object", () => {
    expect(extractQuestions({ questions: qs })).toEqual(qs);
  });

  it("accepts a bare string array", () => {
    expect(extractQuestions(qs)).toEqual(qs);
    expect(extractQuestions(JSON.stringify(qs))).toEqual(qs);
  });

  it("falls back across alternate wrapper keys", () => {
    expect(extractQuestions({ clarifying_questions: qs })).toEqual(qs);
    expect(extractQuestions({ clarifyingQuestions: qs })).toEqual(qs);
    expect(extractQuestions({ items: qs })).toEqual(qs);
    expect(extractQuestions({ data: qs })).toEqual(qs);
  });

  it("finds the array under any unrecognized key", () => {
    expect(extractQuestions({ random_thing: qs })).toEqual(qs);
  });

  it("converts a numeric-keyed object to an array", () => {
    expect(
      extractQuestions({ "1": qs[0], "2": qs[1], "3": qs[2] }),
    ).toEqual(qs);
  });

  it("returns null for unparsable strings", () => {
    expect(extractQuestions("not json {{{")).toBeNull();
  });

  it("returns null for non-array values", () => {
    expect(extractQuestions({ questions: "not an array" })).toBeNull();
    expect(extractQuestions(null)).toBeNull();
    expect(extractQuestions(undefined)).toBeNull();
    expect(extractQuestions(42)).toBeNull();
  });

  it("rejects mixed-type arrays (must be all strings)", () => {
    expect(
      extractQuestions({ questions: ["q", { not: "string" }, "q3"] }),
    ).toBeNull();
  });
});
