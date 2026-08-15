/**
 * Collapse a recipient list so each mailbox receives exactly one copy.
 *
 * Callers pass addresses straight from user input, and mail providers treat
 * `Ada@Example.com` and `ada@example.com` as the same mailbox, so both must
 * collapse to a single recipient.
 */
export function uniqueMailboxes(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()))];
}
