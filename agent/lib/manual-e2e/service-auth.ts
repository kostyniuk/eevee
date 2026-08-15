const FALLBACK_SERVICE_TOKEN = "demo-admin-token";

export function serviceAuthorization(token?: string): string {
  return `Bearer ${token || FALLBACK_SERVICE_TOKEN}`;
}
