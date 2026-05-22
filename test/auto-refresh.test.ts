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

import { clearCache, getCachedSecretString } from "../src/core/cache";
import { loadSecrets } from "../src/load-secrets";

const TEST_KEYS = ["TEST_DB_URL", "TEST_PORT", "TEST_FLAG", "TEST_FROM_AWS"];

function clearTestKeys() {
  for (const key of TEST_KEYS) {
    delete process.env[key];
  }
}

async function flushAsync() {
  // The tick closure is a chain of awaits (fetch → parse → validateAsync → mutate → onRefresh).
  // Drain enough microtask passes for the whole chain to settle under fake timers.
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
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
  clearCache();
  clearTestKeys();
});

afterEach(() => {
  vi.useRealTimers();
  clearTestKeys();
  clearCache();
});

describe("loadSecrets — autoRefresh", () => {
  it("calls onRefresh with the new validated env after each TTL tick", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v2" }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v3" }) });

    const onRefresh = vi.fn();
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh,
    });

    expect(result.success).toBe(true);
    expect(typeof result.stop).toBe("function");
    if (result.success) expect(result.data.TEST_FLAG).toBe("v1");

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls[0]?.[0]).toEqual({ TEST_FLAG: "v2" });

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onRefresh.mock.calls[1]?.[0]).toEqual({ TEST_FLAG: "v3" });

    result.stop?.();
  });

  it("mutates process.env on refresh when processEnv.mutate is set", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FROM_AWS: "first" }) })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FROM_AWS: "second" }) });

    const result = await loadSecrets({
      schema: z.object({ TEST_FROM_AWS: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      processEnv: { mutate: true, overwrite: true },
    });

    expect(result.success).toBe(true);
    expect(process.env["TEST_FROM_AWS"]).toBe("first");

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(process.env["TEST_FROM_AWS"]).toBe("second");

    result.stop?.();
  });

  it("emits onRefreshError on AWS failure, keeps last good cache, next tick still fires", async () => {
    vi.useFakeTimers();
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "good" }) })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "good-again" }) });

    const onRefresh = vi.fn();
    const onRefreshError = vi.fn();
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh,
      onRefreshError,
    });

    expect(result.success).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(onRefreshError.mock.calls[0]?.[0].code).toBe("AWS_FETCH_FAILED");
    // Failed tick must not have written the bad fetch into the cache.
    expect(getCachedSecretString("default:prod/x")).not.toBe("network down");

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls[0]?.[0]).toEqual({ TEST_FLAG: "good-again" });
    // After a successful tick the cache holds the new value.
    expect(getCachedSecretString("default:prod/x")).toBe(
      JSON.stringify({ TEST_FLAG: "good-again" }),
    );

    result.stop?.();
  });

  it("validation failure on refresh: emits error, cache not updated", async () => {
    vi.useFakeTimers();
    const goodPayload = JSON.stringify({ TEST_FLAG: "valid" });
    sendMock
      .mockResolvedValueOnce({ SecretString: goodPayload })
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: 123 }) });

    const onRefreshError = vi.fn();
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh: () => {},
      onRefreshError,
    });

    expect(result.success).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(onRefreshError.mock.calls[0]?.[0].code).toBe("SCHEMA_VALIDATION_FAILED");
    // The bad payload was not written to the cache.
    expect(getCachedSecretString("default:prod/x")).not.toBe(JSON.stringify({ TEST_FLAG: 123 }));

    result.stop?.();
  });

  it("result.stop() halts further ticks", async () => {
    vi.useFakeTimers();
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ TEST_FLAG: "v" }) });

    const onRefresh = vi.fn();
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh,
    });

    expect(result.success).toBe(true);
    result.stop?.();

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("skips a tick if a previous refresh is still in flight", async () => {
    vi.useFakeTimers();
    let resolveSecond: ((value: { SecretString: string }) => void) | undefined;
    sendMock
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v1" }) })
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecond = res;
          }),
      )
      .mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v3" }) });

    const onRefresh = vi.fn();
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh,
    });
    expect(result.success).toBe(true);

    // First tick starts but hangs.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(sendMock).toHaveBeenCalledTimes(2); // initial + first tick

    // Second tick fires while first is still in flight — should be skipped.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(sendMock).toHaveBeenCalledTimes(2);

    // Resolve the hanging fetch.
    resolveSecond?.({ SecretString: JSON.stringify({ TEST_FLAG: "v2" }) });
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls[0]?.[0]).toEqual({ TEST_FLAG: "v2" });

    // Now a fresh tick should run.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(sendMock).toHaveBeenCalledTimes(3);

    result.stop?.();
  });

  it("calling loadSecrets twice for the same (region, secretId) replaces the timer", async () => {
    vi.useFakeTimers();
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ TEST_FLAG: "v" }) });

    const onRefreshA = vi.fn();
    const onRefreshB = vi.fn();

    const r1 = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh: onRefreshA,
    });
    expect(r1.success).toBe(true);

    const r2 = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh: onRefreshB,
    });
    expect(r2.success).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefreshA).not.toHaveBeenCalled();
    expect(onRefreshB).toHaveBeenCalledTimes(1);

    r2.stop?.();
  });

  it("INVALID_OPTIONS when autoRefresh is set without onRefresh or processEnv.mutate", async () => {
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("INVALID_OPTIONS when autoRefresh is set without cache.enabled", async () => {
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: false, ttlMs: 1000, autoRefresh: true },
      onRefresh: () => {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("does not attach result.stop when autoRefresh is off", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: JSON.stringify({ TEST_FLAG: "v" }) });
    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000 },
    });
    expect(result.success).toBe(true);
    expect(result.stop).toBeUndefined();
  });

  it("does not crash when onRefresh throws", async () => {
    vi.useFakeTimers();
    sendMock.mockResolvedValue({ SecretString: JSON.stringify({ TEST_FLAG: "v" }) });
    const onRefresh = vi.fn(() => {
      throw new Error("user code blew up");
    });
    const onRefreshError = vi.fn();

    const result = await loadSecrets({
      schema: z.object({ TEST_FLAG: z.string() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000, autoRefresh: true },
      onRefresh,
      onRefreshError,
    });
    expect(result.success).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // onRefreshError is NOT called for a throwing onRefresh — the refresh itself succeeded.
    expect(onRefreshError).not.toHaveBeenCalled();

    // Next tick still fires.
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(onRefresh).toHaveBeenCalledTimes(2);

    result.stop?.();
  });
});
