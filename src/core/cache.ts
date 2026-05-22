type CacheEntry = {
  value: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const timers = new Map<string, NodeJS.Timeout>();

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

export function startAutoRefresh(key: string, intervalMs: number, tick: () => void): void {
  stopAutoRefresh(key);
  const handle = setInterval(() => {
    tick();
  }, intervalMs);
  if (typeof handle.unref === "function") {
    handle.unref();
  }
  timers.set(key, handle);
}

export function stopAutoRefresh(key: string): void {
  const handle = timers.get(key);
  if (handle !== undefined) {
    clearInterval(handle);
    timers.delete(key);
  }
}

export function stopAllAutoRefresh(): void {
  for (const handle of timers.values()) {
    clearInterval(handle);
  }
  timers.clear();
}

export function clearCache(): void {
  stopAllAutoRefresh();
  cache.clear();
}
