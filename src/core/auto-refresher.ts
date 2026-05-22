export type Refresher = {
  stop: () => void;
};

export type RefresherTick = () => void | Promise<void>;

export type CreateRefresherInput = {
  intervalMs: number;
  tick: RefresherTick;
};

const refreshers = new Set<Refresher>();

export function createRefresher(input: CreateRefresherInput): Refresher {
  let inFlight = false;
  let stopped = false;

  const handle = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        await input.tick();
      } finally {
        inFlight = false;
      }
    })();
  }, input.intervalMs);

  if (typeof handle.unref === "function") {
    handle.unref();
  }

  const refresher: Refresher = {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(handle);
      refreshers.delete(refresher);
    },
  };

  refreshers.add(refresher);
  return refresher;
}

export function stopAllAutoRefresh(): void {
  for (const refresher of [...refreshers]) {
    refresher.stop();
  }
  refreshers.clear();
}
