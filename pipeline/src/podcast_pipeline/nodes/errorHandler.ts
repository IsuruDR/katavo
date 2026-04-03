/**
 * Wraps pipeline execution — updates Supabase on unrecoverable failure.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";

const NOTIFY_COMPLETE_URL = process.env.NOTIFY_COMPLETE_URL ?? "";

export async function handlePipelineFailure(
  podcastId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error: updateError } = await supabase
    .from("podcasts")
    .update({
      status: "failed",
      error_message: errorMessage,
    })
    .eq("id", podcastId);
  if (updateError) {
    console.error(
      `Failed to update podcast failure status: ${updateError.message}`,
    );
  }

  if (NOTIFY_COMPLETE_URL) {
    try {
      await fetch(NOTIFY_COMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podcastId,
          status: "failed",
          errorMessage,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Non-critical
    }
  }
}
