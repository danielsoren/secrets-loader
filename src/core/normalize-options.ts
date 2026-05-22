import {
  DEFAULT_CACHE_AUTO_REFRESH,
  DEFAULT_CACHE_ENABLED,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_PROCESS_ENV_MUTATE,
  DEFAULT_PROCESS_ENV_OVERWRITE,
  DEFAULT_SOURCE,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
import { createError } from "./errors";
import type { LoadSecretsError, LoadSecretsOptions, NormalizedOptions } from "./types";

export type NormalizeResult =
  | { success: true; data: NormalizedOptions }
  | { success: false; error: LoadSecretsError };

const VALID_SOURCES = new Set([
  "provider-only",
  "process-env-only",
  "provider-then-process-env",
  "process-env-then-provider",
]);

export function normalizeOptions<TSchema extends import("zod").z.ZodTypeAny>(
  options: LoadSecretsOptions<TSchema>,
): NormalizeResult {
  const source = options.source ?? DEFAULT_SOURCE;
  if (!VALID_SOURCES.has(source)) {
    return { success: false, error: createError("INVALID_OPTIONS") };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { success: false, error: createError("INVALID_OPTIONS") };
  }

  const cacheEnabled = options.cache?.enabled ?? DEFAULT_CACHE_ENABLED;
  const cacheTtlMs = options.cache?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheAutoRefresh = options.cache?.autoRefresh ?? DEFAULT_CACHE_AUTO_REFRESH;
  if (cacheEnabled && (!Number.isFinite(cacheTtlMs) || cacheTtlMs <= 0)) {
    return { success: false, error: createError("INVALID_OPTIONS") };
  }
  if (cacheAutoRefresh && !cacheEnabled) {
    return { success: false, error: createError("INVALID_OPTIONS") };
  }

  const mutate = options.processEnv?.mutate ?? DEFAULT_PROCESS_ENV_MUTATE;
  const overwrite = options.processEnv?.overwrite ?? DEFAULT_PROCESS_ENV_OVERWRITE;

  if (cacheAutoRefresh && options.onRefresh === undefined && !mutate) {
    return { success: false, error: createError("INVALID_OPTIONS") };
  }

  const awsInput = options.providers?.aws;
  const aws: NormalizedOptions["providers"]["aws"] = {};
  if (awsInput?.secretId !== undefined && awsInput.secretId.length > 0) {
    aws.secretId = awsInput.secretId;
  }
  if (awsInput?.region !== undefined && awsInput.region.length > 0) {
    aws.region = awsInput.region;
  }
  if (awsInput?.credentials !== undefined) {
    const c = awsInput.credentials;
    if (
      typeof c.accessKeyId !== "string" ||
      c.accessKeyId.length === 0 ||
      typeof c.secretAccessKey !== "string" ||
      c.secretAccessKey.length === 0
    ) {
      return { success: false, error: createError("INVALID_OPTIONS") };
    }
    aws.credentials = {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      ...(c.sessionToken !== undefined ? { sessionToken: c.sessionToken } : {}),
    };
  }

  return {
    success: true,
    data: {
      source,
      timeoutMs,
      providers: { aws },
      cache: {
        enabled: cacheEnabled,
        ttlMs: cacheTtlMs,
        autoRefresh: cacheAutoRefresh,
      },
      processEnv: {
        mutate,
        overwrite,
      },
    },
  };
}
