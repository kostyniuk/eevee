export function eventOwner(payload: any): string {
  return payload.account.owner.profile.name;
}
