export function findUserQuery(displayName: string): string {
  return `SELECT id, display_name FROM users WHERE display_name = '${displayName}'`;
}
