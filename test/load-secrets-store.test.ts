import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { sendMock, destroyMock, clientCtorMock, commandCtorMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  destroyMock: vi.fn(),
  clientCtorMock: vi.fn(),
  commandCtorMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: clientCtorMock.mockImplementation((config?: unknown) => ({
      __config: config,
      send: sendMock,
      destroy: destroyMock,
    })),
    GetSecretValueCommand: commandCtorMock.mockImplementation((input: unknown) => ({
      input,
      __command: "GetSecretValueCommand",
    })),
  };
});

import { stopAllAutoRefresh } from "../src/core/auto-refresher";
import { clearCache } from "../src/core/cache";
import { loadSecretsStore } from "../src/store/load-secrets-store";
import { loadSecretsStoreOrExit } from "../src/store/load-secrets-store-or-exit";

const TEST_KEYS = ["TEST_DB_URL", "TEST_FLAG"];

function clearTestKeys() {
  for (const k of TEST_KEYS) delete process.env[k];
}

async function flushAsync() {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

class ProcessExitCalled extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

beforeEach(() => {
  sendMock.mockReset();
  destroyMock.mockReset();
  clientCtorMock.mockReset();
  commandCtorMock.mockReset();
  clientCtorMock.mockImplementation((config?: unknown) => ({
    __config: config,
    send: sendMock,
    destroy: destroyMock,
  }));
  commandCtorMock.mockImplementation((input: unknown) => ({
    input,
    __command: "GetSecretValueCommand",
  }));
  stopAllAutoRefresh();
  clearCache();
  clearTestKeys();
});

afterEach(() => {
  vi.useRealTimers();
  stopAllAutoRefresh();
  clearCache();
  clearTestKeys();
});

describe("loadSecretsStore", () => {
  it("returns Result<SecretsStore> with get() reflecting the initial load", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FLAG: "v1" }),
    });

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.get()).toEqual({ TEST_FLAG: "v1" });
      result.data.stop();
    }
  });

  it("subscribers fire on changed refreshes and stay quiet on identical ones", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) }) // identical
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v2" }) });

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const listener = vi.fn();
    result.data.subscribe(listener);

    // Identical refresh — must NOT fire.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(listener).not.toHaveBeenCalled();
    expect(result.data.get()).toEqual({ TEST_FLAG: "v1" });

    // Changed refresh — fires.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]).toEqual([{ TEST_FLAG: "v2" }, { TEST_FLAG: "v1" }]);
    expect(result.data.get()).toEqual({ TEST_FLAG: "v2" });

    result.data.stop();
  });

  it("refresh AWS failure → onRefreshError fires; no subscribers fire", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) })
      .mockRejectedValueOnce(new Error("network down"));

    const onRefreshError = vi.fn();
    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
      onRefreshError,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const listener = vi.fn();
    result.data.subscribe(listener);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(onRefreshError.mock.calls[0]?.[0].code).toBe("AWS_FETCH_FAILED");
    expect(listener).not.toHaveBeenCalled();
    expect(result.data.get()).toEqual({ TEST_FLAG: "v1" });

    result.data.stop();
  });

  it("refresh validation failure → onRefreshError fires; no subscribers fire", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: 123 }) });

    const onRefreshError = vi.fn();
    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
      onRefreshError,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const listener = vi.fn();
    result.data.subscribe(listener);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(onRefreshError.mock.calls[0]?.[0].code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(listener).not.toHaveBeenCalled();

    result.data.stop();
  });

  it("store.stop() halts further refresh ticks", async () => {
    vi.useFakeTimers();
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) });

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    result.data.stop();
    const initialSendCalls = sendMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(sendMock.mock.calls.length).toBe(initialSendCalls);
  });

  it("stopAllAutoRefresh halts the store's refresh timer too", async () => {
    vi.useFakeTimers();
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) });

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    stopAllAutoRefresh();
    const initialSendCalls = sendMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(sendMock.mock.calls.length).toBe(initialSendCalls);
  });

  it("initial-load failure returns Result<{success:false}>; no refresher starts", async () => {
    sendMock.mockRejectedValueOnce(new Error("network down"));

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("AWS_FETCH_FAILED");
    }
  });

  it("does not require onRefresh / processEnv.mutate (store IS the consumer)", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) });

    const result = await loadSecretsStore({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(result.success).toBe(true);
    if (result.success) result.data.stop();
  });
});

describe("loadSecretsStoreOrExit", () => {
  let stderrChunks: string[] = [];
  let exitCalls: Array<number | undefined> = [];

  beforeEach(() => {
    stderrChunks = [];
    exitCalls = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCalls.push(code);
      throw new ProcessExitCalled(code);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the store directly on success", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FLAG: "v1" }),
    });

    const store = await loadSecretsStoreOrExit({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { ttlMs: 1000 },
    });
    expect(store.get()).toEqual({ TEST_FLAG: "v1" });
    expect(exitCalls).toHaveLength(0);
    store.stop();
  });

  it("formats and exits 1 on initial-load failure", async () => {
    sendMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      loadSecretsStoreOrExit({
        schema: z.object({ TEST_FLAG: z.string() }),
        source: "provider-only",
        providers: { aws: { secretId: "prod/x" } },
        cache: { ttlMs: 1000 },
      }),
    ).rejects.toBeInstanceOf(ProcessExitCalled);

    expect(exitCalls).toEqual([1]);
    const written = stderrChunks.join("");
    expect(written).toContain("AWS_FETCH_FAILED");
  });
});
