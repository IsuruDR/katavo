import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_API_URL ?? "http://localhost:3000";
const SECRET = process.env.PIPELINE_CALLBACK_SECRET;

const envReady = Boolean(process.env.TEST_API_URL && SECRET);

describe.skipIf(!envReady)("POST /api/cron/expansion-prompts", () => {
  it("returns 401 without internal auth header", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/expansion-prompts`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid internal auth", async () => {
    const res = await fetch(`${BASE_URL}/api/cron/expansion-prompts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sent: number; skipped: number };
    expect(typeof json.sent).toBe("number");
    expect(typeof json.skipped).toBe("number");
  });
});
