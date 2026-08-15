type Member = { readonly role: string; readonly email: string };

/** Return the email address of the member holding the given role. */
export function roleEmail(members: readonly Member[], role: string): string | null {
  return members.find((member) => member.role === role)!.email;
}
