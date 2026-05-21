import type { SecretSourceMode } from "./types.js";

export type MergeSourcesInput = {
  source: SecretSourceMode;
  providerValues?: Record<string, unknown>;
  processEnvValues?: Record<string, string | undefined>;
};

export function mergeSources(input: MergeSourcesInput): Record<string, unknown> {
  const { source, providerValues, processEnvValues } = input;

  switch (source) {
    case "provider-only":
      return { ...(providerValues ?? {}) };
    case "process-env-only":
      return { ...(processEnvValues ?? {}) };
    case "provider-then-process-env":
      return { ...(providerValues ?? {}), ...(processEnvValues ?? {}) };
    case "process-env-then-provider":
      return { ...(processEnvValues ?? {}), ...(providerValues ?? {}) };
  }
}
