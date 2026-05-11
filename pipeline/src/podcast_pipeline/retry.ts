/**
 * Transient-error retry helper for upstream LLM/TTS calls.
 *
 * Both Gemini call sites (tagInjector + ttsGemini) periodically hit
 * 503 UNAVAILABLE / "model experiencing high demand" responses from
 * gemini-2.5-flash. Those recover within seconds and shouldn't fail the
 * whole pipeline. This helper retries transient errors with exponential
 * backoff while leaving non-transient errors (auth, malformed request,
 * permanent unavailability) to bubble up immediately so we don't waste
 * the retry budget on irrecoverable cases.
 *
 * Classification covers 5xx, 429, and free-form messages from the
 * Gemini SDK that mention high demand / unavailable / rate limit /
 * overloaded.
 */

export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (typeof e.status === "number" && (e.status === 429 || e.status >= 500)) {
    return true;
  }
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded")
  );
}

export interface RetryTransientOptions {
  /** Attempts excluding the initial try. Total calls = retries + 1. */
  retries: number;
  /** First retry delay in ms; subsequent delays double. */
  baseDelayMs: number;
  /** Optional label for warn logging on each retry. */
  label?: string;
}

export async function retryTransient<T>(
  fn: () => Promise<T>,
  options: RetryTransientOptions,
): Promise<T> {
  const { retries, baseDelayMs, label } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      if (transient && attempt < retries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        if (label) {
          console.warn(
            `[${label}] transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delayMs}ms`,
            { error: err },
          );
        }
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
