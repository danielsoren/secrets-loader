import type { SecretsStore, Unsubscribe } from "../core/types";

type Listener<T> = (next: T, prev: T) => void;

export type InternalSecretsStore<T> = SecretsStore<T> & {
  /** Internal: called by the refresh tick with the latest validated env. */
  dispatch(next: T): void;
  /** Internal: wire the refresher's stop function here. */
  setStop(stop: () => void): void;
};

function safeInvoke<T>(listener: Listener<T>, next: T, prev: T): void {
  try {
    listener(next, prev);
  } catch {
    // Listener exceptions are swallowed so a single bad subscriber cannot abort dispatch.
  }
}

export function createSecretsStore<T>(initial: T): InternalSecretsStore<T> {
  let current = initial;
  let stopped = false;
  let externalStop: (() => void) | undefined;
  const subscribers = new Set<Listener<T>>();

  return {
    get() {
      return current;
    },
    subscribe(listener) {
      subscribers.add(listener);
      const unsub: Unsubscribe = () => {
        subscribers.delete(listener);
      };
      return unsub;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      externalStop?.();
    },
    dispatch(next) {
      if (stopped) return;
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      const prev = current;
      current = next;
      // Snapshot for reentrancy: subscribers added during dispatch fire on the next tick.
      const snapshot = [...subscribers];
      for (const listener of snapshot) {
        safeInvoke(listener, next, prev);
      }
    },
    setStop(stop) {
      externalStop = stop;
    },
  };
}
