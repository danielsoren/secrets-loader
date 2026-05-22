type CacheEntry = {
  value: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export function buildCacheKey(secretId: string, region?: string): string {
  return `${region ?? "default"}:${secretId}`;
}

export function getCachedSecretString(key: string, now: number = Date.now()): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedSecretString(
  key: string,
  value: string,
  ttlMs: number,
  now: number = Date.now(),
): void {
  cache.set(key, { value, expiresAt: now + ttlMs });
}

export function clearCache(): void {
  cache.clear();
}
