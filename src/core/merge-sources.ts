import type { SecretSourceMode } from "./types.js";

export type MergeSourcesInput = {
  source: SecretSourceMode;
  awsValues?: Record<string, unknown>;
  processEnvValues?: Record<string, string | undefined>;
};

export function mergeSources(input: MergeSourcesInput): Record<string, unknown> {
  const { source, awsValues, processEnvValues } = input;

  switch (source) {
    case "aws-only":
      return { ...(awsValues ?? {}) };
    case "process-env-only":
      return { ...(processEnvValues ?? {}) };
    case "aws-then-process-env":
      return { ...(awsValues ?? {}), ...(processEnvValues ?? {}) };
    case "process-env-then-aws":
      return { ...(processEnvValues ?? {}), ...(awsValues ?? {}) };
  }
}
