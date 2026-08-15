const statusColors = new Map([
  ["ready", "green"],
  ["running", "blue"],
  ["blocked", "red"],
  ["waiting", "yellow"],
]);

export function statusBadge(status: string): string {
  return statusColors.get(status) ?? "gray";
}
