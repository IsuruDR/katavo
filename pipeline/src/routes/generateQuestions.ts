/**
 * POST /api/generate-questions
 *
 * Generates 2-3 clarifying questions for a podcast topic using GPT-4o.
 * Checks topic against a moderation blocklist before calling OpenAI.
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    });

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
