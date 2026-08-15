/**
 * Read a `Retry-After` response header as a delay in milliseconds.
 *
 * GitHub sends this header on secondary rate limits before it will accept
 * another request from the same installation.
 */
export function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  return Number(header) * 1_000;
}

/** Wait out a secondary rate limit before the caller retries the request. */
export function waitForRetry(header: string | null): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, retryAfterMs(header)));
}
