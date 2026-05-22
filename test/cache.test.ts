import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  clearCache,
  getCachedSecretString,
  setCachedSecretString,
  startAutoRefresh,
  stopAllAutoRefresh,
  stopAutoRefresh,
} from "../src/core/cache";

describe("cache", () => {
  afterEach(() => {
    clearCache();
    vi.useRealTimers();
  });

  it("returns null when not set", () => {
    expect(getCachedSecretString("missing")).toBeNull();
  });

  it("stores and retrieves a value within TTL", () => {
    setCachedSecretString("k", "v", 1000);
    expect(getCachedSecretString("k")).toBe("v");
  });

  it("expires entries after TTL", () => {
    const now = 1_000_000;
    setCachedSecretString("k", "v", 1000, now);
    expect(getCachedSecretString("k", now + 500)).toBe("v");
    expect(getCachedSecretString("k", now + 1000)).toBeNull();
  });

  it("builds a stable cache key including region", () => {
    expect(buildCacheKey("id-1", "us-east-1")).toBe("us-east-1:id-1");
    expect(buildCacheKey("id-1")).toBe("default:id-1");
  });

  it("startAutoRefresh fires the tick on each interval; stopAutoRefresh halts it", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    startAutoRefresh("k", 1000, tick);

    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(2);

    stopAutoRefresh("k");
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("startAutoRefresh replaces an existing timer for the same key", () => {
    vi.useFakeTimers();
    const tickA = vi.fn();
    const tickB = vi.fn();
    startAutoRefresh("k", 1000, tickA);
    startAutoRefresh("k", 1000, tickB);

    vi.advanceTimersByTime(1000);
    expect(tickA).not.toHaveBeenCalled();
    expect(tickB).toHaveBeenCalledTimes(1);
  });

  it("clearCache also stops all auto-refresh timers", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    startAutoRefresh("k", 1000, tick);

    clearCache();
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("stopAllAutoRefresh clears every registered timer", () => {
    vi.useFakeTimers();
    const tickA = vi.fn();
    const tickB = vi.fn();
    startAutoRefresh("a", 1000, tickA);
    startAutoRefresh("b", 1000, tickB);

    stopAllAutoRefresh();
    vi.advanceTimersByTime(5000);
    expect(tickA).not.toHaveBeenCalled();
    expect(tickB).not.toHaveBeenCalled();
  });
});
