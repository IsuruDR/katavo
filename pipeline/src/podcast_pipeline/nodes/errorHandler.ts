/**
 * Wraps pipeline execution — updates Supabase on unrecoverable failure.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";
import { sendPodcastNotification } from "../../routes/notifyComplete.js";

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

  // Send push notification (direct in-process call, no HTTP overhead)
  try {
    await sendPodcastNotification(podcastId, "failed", errorMessage);
  } catch {
    // Non-critical — notification failure should not prevent error handling
  }
}
