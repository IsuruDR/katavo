import { supabase } from "../lib/supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export async function generateQuestions(topic: string): Promise<string[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${API_URL}/api/generate-questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Failed to generate questions");
  }

  const data = await response.json();
  if (
    !Array.isArray(data?.questions) ||
    !data.questions.every((q: unknown) => typeof q === "string")
  ) {
    throw new Error("Server returned an unexpected shape. Try again.");
  }
  return data.questions;
}

export async function submitPodcast(
  topic: string,
  clarifyingAnswers: Array<{ q: string; a: string }>,
): Promise<{ podcastId: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(`${API_URL}/api/submit-podcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ topic, clarifyingAnswers }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Failed to submit podcast");
  }

  return response.json();
}
