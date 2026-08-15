/** Collapse a recipient list to the addresses that should receive one copy. */
export function uniqueRecipients(emails: readonly string[]): string[] {
  return [...new Set(emails)];
}
