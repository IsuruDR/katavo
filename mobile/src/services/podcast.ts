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

export interface SubmitPodcastArgs {
  topic: string;
  clarifyingAnswers?: Array<{ q: string; a: string }>;
  parentPodcastId?: string;
  sourceChapterTitle?: string;
}

export async function submitPodcast(
  args: SubmitPodcastArgs,
): Promise<{ podcastId: string; status: "queued" | "exists" }> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(`${API_URL}/api/submit-podcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(args),
  });

  // 409 = expansion already exists; not an error — caller navigates to existing
  if (response.status === 409) {
    const { podcastId } = await response.json();
    return { podcastId, status: "exists" };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? "Failed to submit podcast");
  }

  const { podcastId } = await response.json();
  return { podcastId, status: "queued" };
}

/**
 * Issues (or returns the existing) public share token for a podcast the
 * caller owns. The server endpoint is idempotent, so calling twice is
 * safe and returns the same token.
 *
 * 403 = caller is not the owner. 404 = podcast not found / soft-deleted.
 * 409 = podcast not in status 'complete'. Surfaces the server's error
 * string so the UI can render something specific.
 */
export async function issueShareToken(podcastId: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(`${API_URL}/api/share-podcast/${podcastId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? `Failed to share podcast (${response.status})`);
  }

  const data = await response.json();
  if (typeof data?.token !== "string" || data.token.length === 0) {
    throw new Error("Server returned an unexpected shape. Try again.");
  }
  return data.token;
}
