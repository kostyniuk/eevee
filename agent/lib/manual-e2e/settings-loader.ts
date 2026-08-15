export async function loadSettings(read: () => Promise<string>): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await read());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Settings must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
