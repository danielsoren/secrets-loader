import { describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "../src/utils/timeout.js";

describe("withTimeout", () => {
  it("resolves when the inner promise resolves first", async () => {
    const value = await withTimeout(Promise.resolve("ok"), 50);
    expect(value).toBe("ok");
  });

  it("rejects with TimeoutError when the inner promise hangs", async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => {});
    const wrapped = withTimeout(pending, 100);
    const assertion = expect(wrapped).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    vi.useRealTimers();
  });

  it("propagates the inner error when the inner promise rejects", async () => {
    const wrapped = withTimeout(Promise.reject(new Error("boom")), 100);
    await expect(wrapped).rejects.toThrow("boom");
  });
});
