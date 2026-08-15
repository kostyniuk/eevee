type StoredCacheEntry = { value: string; hits: number };
export type CacheEntry = Readonly<StoredCacheEntry>;

const maximumEntries = 100;
const cache = new Map<string, StoredCacheEntry>();

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
