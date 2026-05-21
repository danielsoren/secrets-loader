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

import { clearCache } from "../src/core/cache.js";
import { loadSecrets } from "../src/load-secrets.js";

const TEST_KEYS = [
  "TEST_DB_URL",
  "TEST_PORT",
  "TEST_JWT",
  "TEST_FLAG",
  "TEST_FROM_AWS",
  "TEST_FROM_ENV",
];

function clearTestKeys() {
  for (const key of TEST_KEYS) {
    delete process.env[key];
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

describe("loadSecrets — AWS happy path", () => {
  it("loads, parses, validates, and returns typed data", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        TEST_DB_URL: "https://db.example/app",
        TEST_PORT: "3000",
      }),
    });

    const schema = z.object({
      TEST_DB_URL: z.url(),
      TEST_PORT: z.coerce.number().int().positive(),
    });

    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://db.example/app");
      expect(result.data.TEST_PORT).toBe(3000);
      expect(result.meta.usedSources.aws).toBe(true);
      expect(result.meta.usedSources.processEnv).toBe(false);
      expect(result.meta.secretId).toBe("prod/x");
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not mutate process.env by default", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FLAG: "from-aws" }),
    });

    const schema = z.object({ TEST_FLAG: z.string() });

    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(true);
    expect(process.env["TEST_FLAG"]).toBeUndefined();
  });
});

describe("loadSecrets — source modes", () => {
  it("defaults to provider-then-process-env: env overrides provider", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_DB_URL: "https://aws.example/app" }),
    });
    process.env["TEST_DB_URL"] = "https://local.example/app";

    const schema = z.object({ TEST_DB_URL: z.url() });

    const result = await loadSecrets({
      schema,
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://local.example/app");
      expect(result.meta.source).toBe("provider-then-process-env");
    }
  });

  it("process-env-then-provider: provider overrides env", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_DB_URL: "https://aws.example/app" }),
    });
    process.env["TEST_DB_URL"] = "https://local.example/app";

    const schema = z.object({ TEST_DB_URL: z.url() });

    const result = await loadSecrets({
      schema,
      source: "process-env-then-provider",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://aws.example/app");
    }
  });

  it("process-env-only does not call AWS and does not require secretId", async () => {
    process.env["TEST_DB_URL"] = "https://local.example/app";

    const schema = z.object({ TEST_DB_URL: z.url() });

    const result = await loadSecrets({ schema, source: "process-env-only" });

    expect(result.success).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://local.example/app");
      expect(result.meta.usedSources.aws).toBe(false);
    }
  });

  it("provider-only ignores process.env values", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_DB_URL: "https://aws.example/app" }),
    });
    process.env["TEST_DB_URL"] = "https://local.example/app";

    const schema = z.object({ TEST_DB_URL: z.url() });

    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://aws.example/app");
    }
  });
});

describe("loadSecrets — failures", () => {
  it("returns AWS_SECRET_ID_MISSING when provider mode lacks secretId", async () => {
    const schema = z.object({});
    const result = await loadSecrets({ schema, source: "provider-only" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("AWS_SECRET_ID_MISSING");
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns SECRET_JSON_INVALID for malformed JSON", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: "{not-json" });
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_INVALID");
      expect(result.error.message).not.toContain("{not-json");
    }
  });

  it("returns SECRET_JSON_NOT_OBJECT for arrays", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: "[1,2]" });
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });

  it("returns AWS_SECRET_BINARY_UNSUPPORTED when only SecretBinary is present", async () => {
    sendMock.mockResolvedValueOnce({ SecretBinary: new Uint8Array([1, 2, 3]) });
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("AWS_SECRET_BINARY_UNSUPPORTED");
    }
  });

  it("returns AWS_SECRET_EMPTY when neither SecretString nor SecretBinary is present", async () => {
    sendMock.mockResolvedValueOnce({});
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("AWS_SECRET_EMPTY");
    }
  });

  it("returns AWS_FETCH_FAILED when the SDK rejects", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("AWS_FETCH_FAILED");
    }
  });

  it("returns TIMEOUT when fetch exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    sendMock.mockImplementationOnce(() => new Promise(() => {}));

    const promise = loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      timeoutMs: 100,
    });
    // attach a handler before advancing fake timers so the rejection-then-resolution path is observed
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TIMEOUT");
      expect(result.error.message).not.toContain("prod/x");
    }
  });

  it("returns INVALID_OPTIONS for non-positive timeout", async () => {
    const result = await loadSecrets({
      schema: z.object({}),
      source: "process-env-only",
      timeoutMs: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("returns INVALID_OPTIONS when cache is enabled with non-positive ttl", async () => {
    const result = await loadSecrets({
      schema: z.object({}),
      source: "process-env-only",
      cache: { enabled: true, ttlMs: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("returns INVALID_OPTIONS when explicit credentials are incomplete", async () => {
    const result = await loadSecrets({
      schema: z.object({}),
      source: "provider-only",
      providers: {
        aws: {
          secretId: "prod/x",
          credentials: { accessKeyId: "", secretAccessKey: "x" },
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });
});

describe("loadSecrets — schema validation redaction", () => {
  it("returns sanitized issues without secret values", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_JWT: "leaked-token" }),
    });

    const schema = z.object({ TEST_JWT: z.string().min(32) });

    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.error.message).not.toContain("leaked-token");
      for (const issue of result.error.issues ?? []) {
        expect(issue.message).not.toContain("leaked-token");
        expect(issue.path).not.toContain("leaked-token");
      }
    }
  });
});

describe("loadSecrets — process.env mutation", () => {
  it("does not mutate when disabled (default)", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FROM_AWS: "value-a" }),
    });
    const schema = z.object({ TEST_FROM_AWS: z.string() });
    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    expect(result.success).toBe(true);
    expect(process.env["TEST_FROM_AWS"]).toBeUndefined();
    if (result.success) {
      expect(result.meta.processEnvMutation.performed).toBe(false);
    }
  });

  it("mutates process.env after successful validation", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FROM_AWS: "value-a", TEST_PORT: "8080" }),
    });
    const schema = z.object({
      TEST_FROM_AWS: z.string(),
      TEST_PORT: z.coerce.number(),
    });
    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      processEnv: { mutate: true, overwrite: true },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.meta.processEnvMutation.performed).toBe(true);
      expect(result.meta.processEnvMutation.writtenKeys.sort()).toEqual([
        "TEST_FROM_AWS",
        "TEST_PORT",
      ]);
    }
    expect(process.env["TEST_FROM_AWS"]).toBe("value-a");
    expect(process.env["TEST_PORT"]).toBe("8080");
  });

  it("does not mutate when validation fails", async () => {
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_JWT: "short" }),
    });
    const schema = z.object({ TEST_JWT: z.string().min(32) });
    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      processEnv: { mutate: true, overwrite: true },
    });

    expect(result.success).toBe(false);
    expect(process.env["TEST_JWT"]).toBeUndefined();
  });

  it("overwrite=false preserves existing env values", async () => {
    process.env["TEST_FROM_AWS"] = "original";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FROM_AWS: "replacement" }),
    });
    const schema = z.object({ TEST_FROM_AWS: z.string() });
    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      processEnv: { mutate: true, overwrite: false },
    });

    expect(result.success).toBe(true);
    expect(process.env["TEST_FROM_AWS"]).toBe("original");
    if (result.success) {
      expect(result.meta.processEnvMutation.skippedKeys).toContain("TEST_FROM_AWS");
    }
  });

  it("overwrite=true replaces existing env values", async () => {
    process.env["TEST_FROM_AWS"] = "original";
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_FROM_AWS: "replacement" }),
    });
    const schema = z.object({ TEST_FROM_AWS: z.string() });
    const result = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      processEnv: { mutate: true, overwrite: true },
    });

    expect(result.success).toBe(true);
    expect(process.env["TEST_FROM_AWS"]).toBe("replacement");
  });
});

describe("loadSecrets — cache", () => {
  it("does not cache by default", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ TEST_FLAG: "v" }),
    });
    const schema = z.object({ TEST_FLAG: z.string() });

    await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });
    await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("hits the cache within TTL and reports meta.cache.hit", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ TEST_FLAG: "v" }),
    });
    const schema = z.object({ TEST_FLAG: z.string() });

    const first = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 60_000 },
    });
    expect(first.success).toBe(true);
    if (first.success) expect(first.meta.cache.hit).toBe(false);

    const second = await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 60_000 },
    });
    expect(second.success).toBe(true);
    if (second.success) expect(second.meta.cache.hit).toBe(true);

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ TEST_FLAG: "v" }),
    });
    const schema = z.object({ TEST_FLAG: z.string() });

    await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000 },
    });
    expect(sendMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    await loadSecrets({
      schema,
      source: "provider-only",
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 1000 },
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("caches only AWS SecretString, not merged env (env still re-read)", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ TEST_FROM_AWS: "a" }),
    });
    const schema = z.object({
      TEST_FROM_AWS: z.string(),
      TEST_FROM_ENV: z.string(),
    });

    process.env["TEST_FROM_ENV"] = "one";
    const first = await loadSecrets({
      schema,
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 60_000 },
    });
    expect(first.success).toBe(true);
    if (first.success) expect(first.data.TEST_FROM_ENV).toBe("one");

    process.env["TEST_FROM_ENV"] = "two";
    const second = await loadSecrets({
      schema,
      providers: { aws: { secretId: "prod/x" } },
      cache: { enabled: true, ttlMs: 60_000 },
    });
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.TEST_FROM_ENV).toBe("two");
      expect(second.meta.cache.hit).toBe(true);
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadSecrets — typing", () => {
  it("infers z.output<TSchema> through coercion", async () => {
    process.env["TEST_PORT"] = "3000";
    const schema = z.object({ TEST_PORT: z.coerce.number().int().positive() });
    const result = await loadSecrets({ schema, source: "process-env-only" });
    expect(result.success).toBe(true);
    if (result.success) {
      const p: number = result.data.TEST_PORT;
      expect(p).toBe(3000);
    } else {
      // discriminated union narrowing: data is null on failure
      const _d: null = result.data;
      void _d;
    }
  });
});
