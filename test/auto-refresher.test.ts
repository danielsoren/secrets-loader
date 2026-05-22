import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefresher, stopAllAutoRefresh } from "../src/core/auto-refresher";

async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("auto-refresher", () => {
  afterEach(() => {
    stopAllAutoRefresh();
    vi.useRealTimers();
  });

  it("fires the tick on each interval; stop() halts further ticks", async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const refresher = createRefresher({ intervalMs: 1000, tick });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(2);

    refresher.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("stop() is idempotent", () => {
    vi.useFakeTimers();
    const refresher = createRefresher({ intervalMs: 1000, tick: () => {} });
    refresher.stop();
    expect(() => refresher.stop()).not.toThrow();
  });

  it("skips ticks while a previous one is still in flight", async () => {
    vi.useFakeTimers();
    let resolveTick: (() => void) | undefined;
    const tick = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveTick = res;
        }),
    );

    createRefresher({ intervalMs: 1000, tick });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(1);

    // Second tick fires while first is hung — must be skipped.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(1);

    // Resolve the hanging tick; the next interval boundary should re-arm.
    resolveTick?.();
    await flushAsync();
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("two refreshers run independently", async () => {
    vi.useFakeTimers();
    const tickA = vi.fn();
    const tickB = vi.fn();
    createRefresher({ intervalMs: 1000, tick: tickA });
    createRefresher({ intervalMs: 1000, tick: tickB });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(tickA).toHaveBeenCalledTimes(1);
    expect(tickB).toHaveBeenCalledTimes(1);
  });

  it("stopAllAutoRefresh halts every active refresher", async () => {
    vi.useFakeTimers();
    const tickA = vi.fn();
    const tickB = vi.fn();
    createRefresher({ intervalMs: 1000, tick: tickA });
    createRefresher({ intervalMs: 1000, tick: tickB });

    stopAllAutoRefresh();

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(tickA).not.toHaveBeenCalled();
    expect(tickB).not.toHaveBeenCalled();
  });

  it("a refresher self-deregisters from the registry when stopped", () => {
    vi.useFakeTimers();
    const refresher = createRefresher({ intervalMs: 1000, tick: () => {} });
    refresher.stop();
    // stopAllAutoRefresh after a self-stop should be a no-op (no double-stop).
    expect(() => stopAllAutoRefresh()).not.toThrow();
  });
});
