/**
 * Wraps pipeline execution — updates Supabase on unrecoverable failure.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";

export async function handlePipelineFailure(
  podcastId: string,
  errorMessage: string,
  diagnostics?: Record<string, unknown> | null,
): Promise<void> {
  const supabase = getSupabaseClient();

  const update: Record<string, unknown> = {
    status: "failed",
    error_message: errorMessage,
  };
  if (diagnostics) update.failure_diagnostics = diagnostics;

  const { error: updateError } = await supabase
    .from("podcasts")
    .update(update)
    .eq("id", podcastId);
  if (updateError) {
    console.error(
      `Failed to update podcast failure status: ${updateError.message}`,
    );
  }

  // Send push notification (direct in-process call, no HTTP overhead)
  try {
    await sendPodcastNotification(podcastId, "failed", errorMessage);
  } catch {
    // Non-critical — notification failure should not prevent error handling
  }
}
