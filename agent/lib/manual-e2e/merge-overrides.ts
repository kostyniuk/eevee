/** Apply caller-supplied overrides on top of the default settings. */
export function mergeOverrides(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) merged[key] = value;
  return merged;
}
