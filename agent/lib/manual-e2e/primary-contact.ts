// These numbered lines make this small helper a manual line-mapping fixture.
// Shift 01
// Shift 02
// Shift 03
// Shift 04
// Shift 05
// Shift 06
// Shift 07
// Shift 08
// Shift 09
// Shift 10
// Shift 11
// Shift 12
// Shift 13
// Shift 14
// Shift 15
// Shift 16
// Shift 17
// Shift 18
// Shift 19
// Shift 20
// Shift 21
// Shift 22
// Shift 23
// Shift 24
// Shift 25
// Shift 26
// Shift 27
// Shift 28
// Shift 29
// Shift 30

/** Return the first contact, which the caller defines as the primary contact. */
export function primaryContact(contacts: readonly string[]): string | null {
  return contacts[0] ?? null;
}
