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
                "You are helping a user create a personalized podcast on a topic they've chosen. Generate exactly 2-3 short, focused clarifying questions to understand what angle, depth, and specific aspects they want covered. Return a JSON array of strings. Example: [\"What specific aspect interests you most?\", \"What's your familiarity level with this topic?\"]",
            },
            {
              role: "user",
              content: `Topic: ${topic}`,
            },
          ],
          response_format: { type: "json_object" },
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
    const content = JSON.parse(data.choices[0].message.content);
    const questions = content.questions || content;

    return c.json({ questions });
  } catch {
    return c.json({ error: "Failed to generate questions" }, 500);
  }
});

export { route as generateQuestionsRoute };
