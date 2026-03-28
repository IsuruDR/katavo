import { supabase } from "../lib/supabase";

export async function generateQuestions(topic: string): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke("generate-questions", {
    body: { topic },
  });
  if (error) throw new Error(error.message || "Failed to generate questions");
  return data.questions;
}

export async function submitPodcast(
  topic: string,
  clarifyingAnswers: Array<{ q: string; a: string }>,
  trustedSourceId?: string
): Promise<{ podcastId: string }> {
  const { data, error } = await supabase.functions.invoke("submit-podcast", {
    body: { topic, clarifyingAnswers, trustedSourceId },
  });
  if (error) throw new Error(error.message || "Failed to submit podcast");
  return data;
}
