const slugPattern = /^([a-z]+)+$/u;

export function isValidSlug(value: string): boolean {
  return slugPattern.test(value);
}
