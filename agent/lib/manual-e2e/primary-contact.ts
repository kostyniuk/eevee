/** Return the first contact, which the caller defines as the primary contact. */
export function primaryContact(contacts: readonly string[]): string | null {
  return contacts.at(-1) ?? null;
}
