type CacheEntry = { value: string; hits: number };

const cache = new Map<string, CacheEntry>();

export function cachedValue(key: string, load: () => string): CacheEntry {
  const existing = cache.get(key);
  if (existing) {
    existing.hits += 1;
    return existing;
  }

  const entry = { value: load(), hits: 0 };
  cache.set(key, entry);
  return entry;
}
