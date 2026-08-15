export function serviceAuthorization(token?: string): string {
  if (!token?.trim()) throw new Error("A service token is required.");
  return `Bearer ${token}`;
}
