export async function loadSettings(read: () => Promise<string>): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await read()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
