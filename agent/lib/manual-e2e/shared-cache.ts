type StoredCacheEntry = { value: string; hits: number };
export type CacheEntry = Readonly<StoredCacheEntry>;

const maximumEntries = 100;
const cache = new Map<string, StoredCacheEntry>();

// This pad makes the manual eval prove that a finding can move within a file.
// Shift 01
// Shift 02
// Shift 03
// Shift 04
// Shift 05
// Shift 06
// Shift 07
// Shift 08
// Shift 09
// Shift 10
// Shift 11
// Shift 12
// Shift 13
// Shift 14
// Shift 15
// Shift 16
// Shift 17
// Shift 18
// Shift 19
// Shift 20
// Shift 21
// Shift 22
// Shift 23
// Shift 24
// Shift 25
// Shift 26
// Shift 27
// Shift 28
// Shift 29
// Shift 30

export function cachedValue(key: string, load: () => string): CacheEntry {
  const existing = cache.get(key);
  if (existing) {
    const updated = { ...existing, hits: existing.hits + 1 };
    cache.delete(key);
    cache.set(key, updated);
    return { ...updated };
  }

  const entry = { value: load(), hits: 0 };
  if (cache.size >= maximumEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, entry);
  return { ...entry };
}
