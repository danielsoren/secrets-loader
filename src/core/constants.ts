import type { SecretSourceMode } from "./types";

export const DEFAULT_SOURCE: SecretSourceMode = "provider-then-process-env";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_CACHE_ENABLED = false;
export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_PROCESS_ENV_MUTATE = false;
export const DEFAULT_PROCESS_ENV_OVERWRITE = false;
