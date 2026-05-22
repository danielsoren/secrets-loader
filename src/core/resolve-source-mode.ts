import type { SecretSourceMode } from "./types";

export function sourceUsesProvider(source: SecretSourceMode): boolean {
  return source !== "process-env-only";
}

export function sourceUsesProcessEnv(source: SecretSourceMode): boolean {
  return source !== "provider-only";
}
