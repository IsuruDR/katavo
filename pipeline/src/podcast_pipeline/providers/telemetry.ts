import { PostHog } from "posthog-node";

let client: PostHog | null = null;
let initAttempted = false;

function getClient(): PostHog | null {
  if (initAttempted) return client;
  initAttempted = true;
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
  return client;
}

export function trackEvent(
  event: string,
  properties: Record<string, unknown>,
  distinctId: string,
): void {
  const c = getClient();
  if (!c) return;
  // Posthog rejects empty distinctId. Fall back so smoke runs and edge cases
  // (state without userId) still emit events.
  const effectiveId = distinctId && distinctId.length > 0 ? distinctId : "anonymous-pipeline";
  try {
    c.capture({ distinctId: effectiveId, event, properties });
  } catch (err) {
    console.warn("[telemetry] capture failed:", err);
  }
}

/** Call on graceful pipeline shutdown to flush queued events. */
export async function shutdownTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    console.warn("[telemetry] shutdown failed:", err);
  } finally {
    client = null;
    initAttempted = false;
  }
}
