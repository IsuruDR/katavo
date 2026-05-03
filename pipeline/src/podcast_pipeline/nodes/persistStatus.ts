/**
 * Best-effort persistence of pipeline status to the podcasts row.
 *
 * Pipeline nodes set `status` in returned state, but LangGraph only
 * propagates state in-memory between nodes. The mobile client subscribes
 * to Realtime UPDATEs on public.podcasts and renders status badges from
 * what's in the row, so without this helper the row sits at "queued"
 * for the entire generation and snaps to "complete"/"failed" at the end.
 *
 * Each pipeline transition calls this at the start of the relevant step
 * (briefBuilder / scriptWriter / audioProducer). Failures are logged but
 * don't fail the pipeline — the in-memory state is still authoritative
 * for routing.
 */

import { getSupabaseClient } from "../providers/supabaseClient.js";

export async function persistStatus(
  podcastId: string,
  status: string,
): Promise<void> {
  if (!podcastId) return;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("podcasts")
      .update({ status })
      .eq("id", podcastId);
    if (error) {
      console.error(
        `persistStatus(${status}) failed for ${podcastId}: ${error.message}`,
      );
    }
  } catch (err: unknown) {
    console.error(
      `persistStatus(${status}) threw for ${podcastId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
