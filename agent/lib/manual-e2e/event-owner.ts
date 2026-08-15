type EventPayload = {
  readonly account?: {
    readonly owner?: { readonly profile?: { readonly name?: unknown } };
  };
};

export function eventOwner(payload: EventPayload): string {
  const name = payload.account?.owner?.profile?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Event payload has no owner name.");
  }
  return name;
}
