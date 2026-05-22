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
import { loadSecrets } from "../src/load-secrets";

const ENV_KEYS = ["NODE_ENV", "AWS_SECRETS_ID", "AWS_REGION", "TEST_DB_URL", "TEST_PORT"];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
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
  clearEnv();
});

afterEach(() => {
  clearEnv();
  clearCache();
});

describe("loadSecrets — bootstrap", () => {
  it("parses bootstrap and drives source / providers via functions", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AWS_SECRETS_ID"] = "prod/api";
    process.env["AWS_REGION"] = "eu-central-1";

    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_DB_URL: "https://db.example/app" }),
    });

    const bootstrap = z.object({
      NODE_ENV: z.enum(["development", "production"]),
      AWS_SECRETS_ID: z.string().min(1),
      AWS_REGION: z.string().min(1),
    });

    const result = await loadSecrets({
      bootstrap,
      schema: z.object({ TEST_DB_URL: z.url() }),
      source: (b) => (b.NODE_ENV === "production" ? "provider-only" : "process-env-only"),
      providers: (b) => ({ aws: { secretId: b.AWS_SECRETS_ID, region: b.AWS_REGION } }),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://db.example/app");
      expect(result.meta.secretId).toBe("prod/api");
      expect(result.meta.region).toBe("eu-central-1");
      expect(result.meta.source).toBe("provider-only");
    }
  });

  it("skips AWS entirely when bootstrap selects process-env-only", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["AWS_SECRETS_ID"] = "dev/api";
    process.env["AWS_REGION"] = "eu-central-1";
    process.env["TEST_DB_URL"] = "https://local.example/app";

    const bootstrap = z.object({
      NODE_ENV: z.enum(["development", "production"]),
      AWS_SECRETS_ID: z.string().min(1),
      AWS_REGION: z.string().min(1),
    });

    const result = await loadSecrets({
      bootstrap,
      schema: z.object({ TEST_DB_URL: z.url() }),
      source: (b) => (b.NODE_ENV === "production" ? "provider-only" : "process-env-only"),
      providers: (b) =>
        b.NODE_ENV === "production"
          ? { aws: { secretId: b.AWS_SECRETS_ID, region: b.AWS_REGION } }
          : undefined,
    });

    expect(result.success).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.TEST_DB_URL).toBe("https://local.example/app");
      expect(result.meta.source).toBe("process-env-only");
    }
  });

  it("returns BOOTSTRAP_VALIDATION_FAILED with issues and ZodError cause", async () => {
    const bootstrap = z.object({
      NODE_ENV: z.enum(["development", "production"]),
      AWS_SECRETS_ID: z.string().min(1),
    });

    const result = await loadSecrets({
      bootstrap,
      schema: z.object({}),
      source: () => "process-env-only" as const,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("BOOTSTRAP_VALIDATION_FAILED");
      expect(result.error.issues).toBeDefined();
      expect((result.error.issues ?? []).length).toBeGreaterThan(0);
      expect(result.error.cause).toBeInstanceOf(z.ZodError);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_OPTIONS when source is a function but no bootstrap is given", async () => {
    const result = await loadSecrets({
      schema: z.object({}),
      // @ts-expect-error — function form requires a bootstrap schema at the type level
      source: () => "process-env-only" as const,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("returns INVALID_OPTIONS when providers is a function but no bootstrap is given", async () => {
    const result = await loadSecrets({
      schema: z.object({}),
      source: "process-env-only",
      // @ts-expect-error — function form requires a bootstrap schema at the type level
      providers: () => undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_OPTIONS");
    }
  });

  it("attaches ZodError as cause on SCHEMA_VALIDATION_FAILED too", async () => {
    process.env["TEST_DB_URL"] = "not-a-url";
    const result = await loadSecrets({
      schema: z.object({ TEST_DB_URL: z.url() }),
      source: "process-env-only",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.error.cause).toBeInstanceOf(z.ZodError);
    }
  });

  it("accepts literal source/providers alongside a bootstrap schema", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["AWS_SECRETS_ID"] = "prod/api";

    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({ TEST_PORT: "3000" }),
    });

    const result = await loadSecrets({
      bootstrap: z.object({
        NODE_ENV: z.enum(["development", "production"]),
        AWS_SECRETS_ID: z.string().min(1),
      }),
      schema: z.object({ TEST_PORT: z.coerce.number() }),
      source: "provider-only",
      providers: { aws: { secretId: "prod/api" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TEST_PORT).toBe(3000);
    }
  });
});
