// supabase/functions/generate-questions/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const MODERATION_BLOCKLIST = [
  "how to make a bomb",
  "how to harm",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { topic } = await req.json();

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Topic is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const lowerTopic = topic.toLowerCase();
    for (const pattern of MODERATION_BLOCKLIST) {
      if (lowerTopic.includes(pattern)) {
        return new Response(
          JSON.stringify({ error: "This topic is not supported. Please try a different topic." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are helping a user create a personalized podcast on a topic they've chosen. Generate exactly 2-3 short, focused clarifying questions to understand what angle, depth, and specific aspects they want covered. Return a JSON array of strings. Example: ["What specific aspect interests you most?", "What's your familiarity level with this topic?"]`,
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

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    const questions = content.questions || content;

    return new Response(
      JSON.stringify({ questions }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to generate questions" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
