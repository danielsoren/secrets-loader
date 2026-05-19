import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  clearCache,
  getCachedSecretString,
  setCachedSecretString,
} from "../src/core/cache.js";

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
});
