/** Return the slice of items that belongs on the given zero-based page. */
export function pageWindow<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize - 1);
}
