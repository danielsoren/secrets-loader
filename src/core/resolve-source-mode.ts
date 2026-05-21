import type { SecretSourceMode } from "./types.js";

export function sourceUsesProvider(source: SecretSourceMode): boolean {
  return source !== "process-env-only";
}

export function sourceUsesProcessEnv(source: SecretSourceMode): boolean {
  return source !== "provider-only";
}
