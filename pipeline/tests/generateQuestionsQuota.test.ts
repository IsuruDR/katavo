import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@supabase/supabase-js";
const mockCreateClient = vi.mocked(createClient);

import { checkAndIncrementQuota } from "../src/routes/generateQuestions.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ProfileRow {
  generate_questions_count: number;
  generate_questions_day: string | null;
}

function buildSupabase(profile: ProfileRow | null, options?: { profileErr?: any }) {
  const updateSpy = vi.fn().mockReturnThis();
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const lookupChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: profile, error: options?.profileErr ?? null }),
  };
  const updateChain = {
    update: updateSpy,
    eq: updateEq,
  };
  let fromCalls = 0;
  const client = {
    from: vi.fn(() => {
      fromCalls += 1;
      return fromCalls === 1 ? lookupChain : updateChain;
    }),
  } as any;
  return { client, updateSpy, updateEq };
}

describe("checkAndIncrementQuota", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  });

  it("allows the first call and increments from 0", async () => {
    const { client, updateSpy } = buildSupabase({
      generate_questions_count: 0,
      generate_questions_day: null,
    });
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
    expect(updateSpy).toHaveBeenCalledWith({
      generate_questions_count: 1,
      generate_questions_day: todayIso(),
    });
  });

  it("rolls the counter over when the stored day is yesterday", async () => {
    const { client, updateSpy } = buildSupabase({
      generate_questions_count: 50, // hit yesterday's limit
      generate_questions_day: "2026-05-01",
    });
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
    expect(updateSpy).toHaveBeenCalledWith({
      generate_questions_count: 1,
      generate_questions_day: todayIso(),
    });
  });

  it("blocks when today's count is at the limit", async () => {
    const { client, updateSpy } = buildSupabase({
      generate_questions_count: 50,
      generate_questions_day: todayIso(),
    });
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("blocks when today's count is over the limit", async () => {
    const { client, updateSpy } = buildSupabase({
      generate_questions_count: 99,
      generate_questions_day: todayIso(),
    });
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("fails open if profile lookup errors so a DB blip never breaks generation", async () => {
    const { client, updateSpy } = buildSupabase(null, { profileErr: { message: "db down" } });
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("fails open if profile not found (defensive)", async () => {
    const { client, updateSpy } = buildSupabase(null);
    mockCreateClient.mockReturnValue(client);

    const result = await checkAndIncrementQuota("user-1");

    expect(result.allowed).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
