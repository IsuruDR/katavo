/**
 * Submits a chapter expansion. Handles 409 (already exists — caller
 * should navigate to the existing podcast id) and surfaces errors
 * for the caller to render.
 */
import { useState, useCallback } from "react";
import { submitPodcast } from "../services/podcast";

export interface UseExpansionSubmitResult {
  submit: (parentPodcastId: string, sourceChapterTitle: string) => Promise<{
    podcastId: string;
    alreadyExisted: boolean;
  }>;
  submitting: boolean;
  error: string | null;
}

export function useExpansionSubmit(): UseExpansionSubmitResult {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (parentPodcastId: string, sourceChapterTitle: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitPodcast({
          topic: "",
          parentPodcastId,
          sourceChapterTitle,
        });
        return {
          podcastId: result.podcastId,
          alreadyExisted: result.status === "exists",
        };
      } catch (err: any) {
        setError(err?.message ?? "Expansion failed");
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submit, submitting, error };
}
