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

import { clearCache } from "../src/core/cache";
import { loadSecretsOrExit } from "../src/load-secrets-or-exit";

class ProcessExitCalled extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const ENV_KEYS = ["TEST_DB_URL", "TEST_PORT"];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

const stderrChunks: string[] = [];
const exitCalls: Array<number | undefined> = [];

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
  clearEnv();
  stderrChunks.length = 0;
  exitCalls.length = 0;

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
  clearEnv();
  clearCache();
  vi.restoreAllMocks();
});

describe("loadSecretsOrExit", () => {
  it("returns data directly on success", async () => {
    process.env["TEST_PORT"] = "3000";
    const env = await loadSecretsOrExit({
      schema: z.object({ TEST_PORT: z.coerce.number().int().positive() }),
      source: "process-env-only",
    });
    expect(env.TEST_PORT).toBe(3000);
    expect(exitCalls).toHaveLength(0);
  });

  it("writes a formatted error to stderr and exits 1 on failure", async () => {
    process.env["TEST_DB_URL"] = "not-a-url";
    await expect(
      loadSecretsOrExit({
        schema: z.object({ TEST_DB_URL: z.url() }),
        source: "process-env-only",
      }),
    ).rejects.toBeInstanceOf(ProcessExitCalled);

    expect(exitCalls).toEqual([1]);
    const written = stderrChunks.join("");
    expect(written).toContain("SCHEMA_VALIDATION_FAILED");
    expect(written).toContain("TEST_DB_URL");
  });

  it("works with bootstrap + functions and exits with prettified bootstrap error", async () => {
    await expect(
      loadSecretsOrExit({
        bootstrap: z.object({
          NODE_ENV: z.enum(["development", "production"]),
          AWS_SECRETS_ID: z.string().min(1),
        }),
        schema: z.object({}),
        source: (b) => (b.NODE_ENV === "production" ? "provider-only" : "process-env-only"),
      }),
    ).rejects.toBeInstanceOf(ProcessExitCalled);

    expect(exitCalls).toEqual([1]);
    const written = stderrChunks.join("");
    expect(written).toContain("BOOTSTRAP_VALIDATION_FAILED");
    expect(written).toContain("NODE_ENV");
  });
});
