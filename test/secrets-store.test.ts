import { describe, expect, it, vi } from "vitest";
import { createSecretsStore } from "../src/store/secrets-store";

type Env = { A: string; B: number };

describe("SecretsStore", () => {
  it("get() returns the initial value", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    expect(store.get()).toEqual({ A: "a", B: 1 });
  });

  it("subscribe does not fire on registration", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribe fires with (next, prev) on dispatch with a changed value", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ A: "b", B: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]).toEqual([
      { A: "b", B: 1 },
      { A: "a", B: 1 },
    ]);
    expect(store.get()).toEqual({ A: "b", B: 1 });
  });

  it("does NOT fire when the dispatched env is structurally identical", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ A: "a", B: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple subscribers fire in registration order", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const calls: string[] = [];
    store.subscribe(() => calls.push("first"));
    store.subscribe(() => calls.push("second"));
    store.subscribe(() => calls.push("third"));

    store.dispatch({ A: "b", B: 1 });

    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("unsubscribe stops further fires for that listener", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = store.subscribe(a);
    store.subscribe(b);

    store.dispatch({ A: "b", B: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    store.dispatch({ A: "c", B: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("subscribers added during dispatch do not fire on the current tick", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const late = vi.fn();
    store.subscribe(() => {
      store.subscribe(late);
    });

    store.dispatch({ A: "b", B: 1 });
    expect(late).not.toHaveBeenCalled();

    store.dispatch({ A: "c", B: 1 });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not abort dispatch for other listeners", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    store.subscribe(bad);
    store.subscribe(good);

    expect(() => store.dispatch({ A: "b", B: 1 })).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("stop() calls the wired stop function exactly once and is idempotent", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    const stopFn = vi.fn();
    store.setStop(stopFn);

    store.stop();
    store.stop();
    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it("after stop(): get() still returns last value; subscribers added later never fire", () => {
    const store = createSecretsStore<Env>({ A: "a", B: 1 });
    store.setStop(() => {});

    store.dispatch({ A: "b", B: 1 });
    store.stop();

    const late = vi.fn();
    store.subscribe(late);

    // Direct dispatch after stop is a noop too.
    store.dispatch({ A: "c", B: 1 });
    expect(late).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ A: "b", B: 1 });
  });
});
