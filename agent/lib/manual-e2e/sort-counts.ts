/** Order usage counts from largest to smallest. */
export function sortCounts(counts: readonly number[]): number[] {
  return [...counts].sort().reverse();
}
