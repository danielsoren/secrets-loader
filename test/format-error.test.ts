import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatLoadSecretsError } from "../src/utils/format-error";

describe("formatLoadSecretsError", () => {
  it("prettifies a ZodError via z.prettifyError when present on cause", () => {
    const schema = z.object({
      DATABASE_URL: z.url(),
      JWT_SECRET: z.string().min(32),
    });
    const parsed = schema.safeParse({ DATABASE_URL: "not-a-url", JWT_SECRET: "short" });
    if (parsed.success) throw new Error("expected zod parse to fail");

    const output = formatLoadSecretsError({
      code: "SCHEMA_VALIDATION_FAILED",
      message: "Secret validation failed.",
      issues: [
        { path: "DATABASE_URL", message: "Invalid URL" },
        { path: "JWT_SECRET", message: "Too short" },
      ],
      cause: parsed.error,
    });

    expect(output).toContain("SCHEMA_VALIDATION_FAILED");
    expect(output).toContain("Secret validation failed.");
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("JWT_SECRET");
  });

  it("renders issues list when cause is not a ZodError", () => {
    const output = formatLoadSecretsError({
      code: "BOOTSTRAP_VALIDATION_FAILED",
      message: "Bootstrap environment validation failed.",
      issues: [
        { path: "NODE_ENV", message: "Required" },
        { path: "AWS_SECRETS_ID", message: "Required" },
      ],
    });

    expect(output).toContain("BOOTSTRAP_VALIDATION_FAILED");
    expect(output).toContain("  - NODE_ENV: Required");
    expect(output).toContain("  - AWS_SECRETS_ID: Required");
  });

  it("returns the bare header when there are no issues and no ZodError cause", () => {
    const output = formatLoadSecretsError({
      code: "AWS_FETCH_FAILED",
      message: "Failed to fetch secret from AWS Secrets Manager.",
    });

    expect(output).toBe("AWS_FETCH_FAILED: Failed to fetch secret from AWS Secrets Manager.");
  });
});
