/**
 * POST /api/generate-questions
 *
 * Generates 2-3 clarifying questions for a podcast topic using GPT-4o.
 * Checks topic against a moderation blocklist before calling OpenAI.
 * Auto-retries on 429 with the Retry-After hint (matching the
 * deepResearch backoff pattern).
 *
 * Auth: userAuth middleware (JWT)
 * Request body: { topic: string }
 * Response: { questions: string[] }
 */

import { Hono } from "hono";
import { userAuth } from "../middleware/auth.js";

const MODERATION_BLOCKLIST = [
  "how to make a bomb",
  "how to harm",
];

// Rate-limit retry budget. Mirrors deepResearch's policy: 2 retries,
// honor Retry-After when present, cap per-retry wait at 30s.
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_WAIT_PER_RETRY_MS = 30_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

/**
 * Fetch with auto-retry on HTTP 429. Honors the Retry-After header (in
 * seconds). Network errors bubble out unchanged. Non-429 responses
 * (including the eventual successful one or a hard 5xx) are returned
 * to the caller for normal handling.
 */
export async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  maxRetries: number = MAX_RATE_LIMIT_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429) return response;
    if (attempt >= maxRetries) return response;

    const retryAfter = response.headers.get("retry-after");
    const parsedSeconds = retryAfter ? Number(retryAfter) : NaN;
    const baseMs =
      Number.isFinite(parsedSeconds) && parsedSeconds > 0
        ? parsedSeconds * 1000
        : DEFAULT_RATE_LIMIT_WAIT_MS;
    const waitMs = Math.min(baseMs + 500, MAX_WAIT_PER_RETRY_MS);

    console.log(
      `OpenAI rate-limited at ${url} (attempt ${attempt + 1}/${maxRetries + 1}); ` +
        `waiting ${waitMs}ms before retry`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  // Loop always returns inside the body; this is unreachable.
  throw new Error("fetchWithRateLimitRetry: unreachable");
}

const route = new Hono();

route.post("/", userAuth, async (c) => {
  try {
    const { topic } = await c.req.json();

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return c.json({ error: "Topic is required" }, 400);
    }

    const lowerTopic = topic.toLowerCase();
    for (const pattern of MODERATION_BLOCKLIST) {
      if (lowerTopic.includes(pattern)) {
        return c.json(
          { error: "This topic is not supported. Please try a different topic." },
          400,
        );
      }
    }

    const response = await fetchWithRateLimitRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are helping a user create a personalized podcast on a topic they've chosen. Generate exactly 2-3 short, focused clarifying questions to understand what angle, depth, and specific aspects they want covered.",
            },
            {
              role: "user",
              content: `Topic: ${topic}`,
            },
          ],
          // Structured output: guarantees { questions: string[] } shape.
          // The previous "json_object" mode let the model wrap the array
          // under arbitrary keys (clarifying_questions, items, numeric
          // keys), which broke the client.
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "clarifying_questions",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
          max_tokens: 300,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("OpenAI API error:", response.status, errorBody);
      return c.json({ error: "Failed to generate questions" }, 500);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;
    const questions = extractQuestions(rawContent);

    if (!questions || questions.length === 0) {
      console.error(
        "generate-questions: unexpected response shape",
        JSON.stringify(rawContent ?? data).slice(0, 800),
      );
      return c.json({ error: "Failed to generate questions" }, 500);
    }

    return c.json({ questions });
  } catch (err: unknown) {
    console.error(
      "generate-questions: unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return c.json({ error: "Failed to generate questions" }, 500);
  }
});

/**
 * Pull the questions array out of whatever shape the model returned.
 * Strict json_schema mode should always give us { questions: string[] },
 * but the defensive paths cover model drift, parsing failures, and the
 * occasional flat-array response. Returns null when nothing usable
 * appears so the caller can surface a 500 with the raw payload logged.
 */
export function extractQuestions(raw: unknown): string[] | null {
  let content: unknown = raw;
  if (typeof raw === "string") {
    try {
      content = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  if (isStringArray(content)) return content;

  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (isStringArray(obj.questions)) return obj.questions;
    for (const key of [
      "clarifying_questions",
      "clarifyingQuestions",
      "items",
      "data",
      "result",
      "list",
    ]) {
      if (isStringArray(obj[key])) return obj[key] as string[];
    }
    // Any nested string-array
    for (const v of Object.values(obj)) {
      if (isStringArray(v)) return v;
    }
    // Object with numeric keys: { "1": "Q1", "2": "Q2" }. Require keys
    // to actually be digits — otherwise a single { questions: "string" }
    // would falsely match.
    const keys = Object.keys(obj);
    if (
      keys.length > 0 &&
      keys.every((k) => /^\d+$/.test(k))
    ) {
      const sorted = [...keys].sort(
        (a, b) => parseInt(a, 10) - parseInt(b, 10),
      );
      const values = sorted.map((k) => obj[k]);
      if (values.every((v) => typeof v === "string")) {
        return values as string[];
      }
    }
  }

  return null;
}

export { route as generateQuestionsRoute };
