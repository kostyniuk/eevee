/**
 * Longest delay worth honouring before giving the request back to the caller.
 *
 * A secondary rate limit can name a retry window of many minutes. Sleeping
 * that long inside a webhook turn holds the sandbox open for no benefit, so
 * the delay is capped and the caller decides whether to requeue the work.
 */
const maxDelayMs = 60_000;

/**
 * Read a `Retry-After` response header as a delay in milliseconds.
 *
 * GitHub sends this header on secondary rate limits before it will accept
 * another request from the same installation.
 */
export function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  return clampDelay(parseDelayMs(header));
}

/** Wait out a secondary rate limit before the caller retries the request. */
export function waitForRetry(header: string | null): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, retryAfterMs(header)));
}

/**
 * Parse either `Retry-After` form defined by RFC 9110.
 *
 * The header is either a whole number of seconds or an HTTP-date naming the
 * moment the caller may retry. Both appear in GitHub responses.
 */
function parseDelayMs(header: string): number {
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1_000;
  const when = Date.parse(header);
  return Number.isNaN(when) ? 0 : when - Date.now();
}

/** Keep the delay inside a range a single turn can afford to wait. */
function clampDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs < 0) return 0;
  return Math.min(delayMs, maxDelayMs);
}
