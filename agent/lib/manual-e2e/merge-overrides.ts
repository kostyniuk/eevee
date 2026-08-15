/** Apply caller-supplied overrides on top of the default settings. */
export function mergeOverrides(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) setKnown(merged, key, value);
  return merged;
}

/** Assign only keys the defaults already declare, so `__proto__` cannot be reached. */
function setKnown(target: Record<string, string>, key: string, value: string): void {
  if (Object.hasOwn(target, key)) target[key] = value;
}
