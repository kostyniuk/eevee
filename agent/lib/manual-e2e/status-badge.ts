export function statusBadge(status: string): string {
  return status === "ready"
    ? "green"
    : status === "running"
      ? "blue"
      : status === "blocked"
        ? "red"
        : status === "waiting"
          ? "yellow"
          : "gray";
}
