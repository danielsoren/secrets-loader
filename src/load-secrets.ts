import type { z } from "zod";
import { fetchSecretString } from "./aws/fetch-secret-string";
import {
  buildCacheKey,
  getCachedSecretString,
  setCachedSecretString,
  startAutoRefresh,
  stopAutoRefresh,
} from "./core/cache";
import { createError } from "./core/errors";
import { mergeSources } from "./core/merge-sources";
import { normalizeOptions } from "./core/normalize-options";
import { mutateProcessEnv, snapshotProcessEnv } from "./core/process-env";
import { resolveBootstrap } from "./core/resolve-bootstrap";
import { resolveProviders, resolveSource } from "./core/resolve-options-fn";
import { sourceUsesProcessEnv, sourceUsesProvider } from "./core/resolve-source-mode";
import { failure, success } from "./core/result";
import type {
  LoadSecretsError,
  LoadSecretsMeta,
  LoadSecretsOptions,
  LoadSecretsResult,
  NormalizedOptions,
  ProvidersOption,
  SecretSourceMode,
} from "./core/types";
import { validateSchema } from "./core/validate-schema";
import { parseJsonSecret } from "./utils/parse-json-secret";

function createInitialMeta(normalized: NormalizedOptions): LoadSecretsMeta {
  const meta: LoadSecretsMeta = {
    source: normalized.source,
    loadedAt: new Date(),
    cache: {
      enabled: normalized.cache.enabled,
      hit: false,
      autoRefresh: normalized.cache.autoRefresh,
    },
    usedSources: {
      aws: sourceUsesProvider(normalized.source),
      processEnv: sourceUsesProcessEnv(normalized.source),
    },
    processEnvMutation: {
      requested: normalized.processEnv.mutate,
      performed: false,
      overwrite: normalized.processEnv.overwrite,
      writtenKeys: [],
      skippedKeys: [],
    },
  };
  if (normalized.providers.aws.secretId !== undefined) {
    meta.secretId = normalized.providers.aws.secretId;
  }
  if (normalized.providers.aws.region !== undefined) {
    meta.region = normalized.providers.aws.region;
  }
  if (normalized.cache.enabled) {
    meta.cache.ttlMs = normalized.cache.ttlMs;
  }
  return meta;
}

function buildBaseMeta(
  reportedSource: SecretSourceMode,
  processEnv: { mutate?: boolean; overwrite?: boolean } | undefined,
): LoadSecretsMeta {
  return {
    source: reportedSource,
    loadedAt: new Date(),
    cache: { enabled: false, hit: false, autoRefresh: false },
    usedSources: {
      aws: sourceUsesProvider(reportedSource),
      processEnv: sourceUsesProcessEnv(reportedSource),
    },
    processEnvMutation: {
      requested: processEnv?.mutate ?? false,
      performed: false,
      overwrite: processEnv?.overwrite ?? false,
      writtenKeys: [],
      skippedKeys: [],
    },
  };
}

type RefreshTickArgs<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  normalized: NormalizedOptions;
  cacheKey: string;
  onRefresh?: (env: z.output<TSchema>, meta: LoadSecretsMeta) => void;
  onRefreshError?: (error: LoadSecretsError) => void;
};

function safeInvoke<T extends (...args: never[]) => void>(
  fn: T | undefined,
  ...args: Parameters<T>
): void {
  if (fn === undefined) return;
  try {
    fn(...args);
  } catch {
    // Callback errors are swallowed to avoid crashing the timer loop.
  }
}

function makeRefreshTick<TSchema extends z.ZodTypeAny>(args: RefreshTickArgs<TSchema>): () => void {
  const { schema, normalized, cacheKey, onRefresh, onRefreshError } = args;
  let inFlight = false;

  return () => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const meta = createInitialMeta(normalized);

        const aws = normalized.providers.aws;
        if (aws.secretId === undefined || aws.secretId.length === 0) {
          safeInvoke(onRefreshError, createError("AWS_SECRET_ID_MISSING"));
          return;
        }

        const fetchResult = await fetchSecretString({
          secretId: aws.secretId,
          timeoutMs: normalized.timeoutMs,
          ...(aws.region !== undefined ? { region: aws.region } : {}),
          ...(aws.credentials !== undefined ? { credentials: aws.credentials } : {}),
        });
        if (!fetchResult.success) {
          safeInvoke(onRefreshError, fetchResult.error);
          return;
        }

        const parsed = parseJsonSecret(fetchResult.secretString);
        if (!parsed.success) {
          safeInvoke(onRefreshError, parsed.error);
          return;
        }

        const processEnvValues = sourceUsesProcessEnv(normalized.source)
          ? snapshotProcessEnv()
          : undefined;

        const merged = mergeSources({
          source: normalized.source,
          providerValues: parsed.data,
          ...(processEnvValues !== undefined ? { processEnvValues } : {}),
        });

        const validation = await validateSchema(schema, merged);
        if (!validation.success) {
          safeInvoke(
            onRefreshError,
            createError("SCHEMA_VALIDATION_FAILED", {
              issues: validation.issues,
              cause: validation.error,
            }),
          );
          return;
        }

        setCachedSecretString(cacheKey, fetchResult.secretString, normalized.cache.ttlMs);

        if (normalized.processEnv.mutate) {
          const validatedRecord =
            validation.data &&
            typeof validation.data === "object" &&
            !Array.isArray(validation.data)
              ? (validation.data as Record<string, unknown>)
              : {};
          const mutation = mutateProcessEnv(validatedRecord, normalized.processEnv.overwrite);
          meta.processEnvMutation.writtenKeys = mutation.writtenKeys;
          meta.processEnvMutation.skippedKeys = mutation.skippedKeys;
          if (!mutation.success) {
            safeInvoke(onRefreshError, mutation.error);
            return;
          }
          meta.processEnvMutation.performed = true;
        }

        safeInvoke(onRefresh, validation.data, meta);
      } catch (cause) {
        safeInvoke(onRefreshError, createError("UNKNOWN", { cause }));
      } finally {
        inFlight = false;
      }
    })();
  };
}

export async function loadSecrets<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
>(options: LoadSecretsOptions<TSchema, TBootstrap>): Promise<LoadSecretsResult<z.output<TSchema>>> {
  let bootstrapData: unknown = undefined;
  const hasBootstrap = options.bootstrap !== undefined;

  if (options.bootstrap !== undefined) {
    const bootstrapResult = resolveBootstrap(options.bootstrap);
    if (!bootstrapResult.success) {
      return failure(
        buildBaseMeta("provider-then-process-env", options.processEnv),
        bootstrapResult.error,
      );
    }
    bootstrapData = bootstrapResult.data;
  }

  const sourceResult = resolveSource(
    options.source as Parameters<typeof resolveSource>[0],
    bootstrapData,
    hasBootstrap,
  );
  if (!sourceResult.success) {
    return failure(
      buildBaseMeta("provider-then-process-env", options.processEnv),
      sourceResult.error,
    );
  }

  const providersResult = resolveProviders(
    options.providers as Parameters<typeof resolveProviders>[0],
    bootstrapData,
    hasBootstrap,
  );
  if (!providersResult.success) {
    return failure(
      buildBaseMeta("provider-then-process-env", options.processEnv),
      providersResult.error,
    );
  }

  const resolvedSource: SecretSourceMode | undefined = sourceResult.data;
  const resolvedProviders: ProvidersOption | undefined = providersResult.data;

  const normalizeInput = {
    schema: options.schema,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.processEnv !== undefined ? { processEnv: options.processEnv } : {}),
    ...(resolvedSource !== undefined ? { source: resolvedSource } : {}),
    ...(resolvedProviders !== undefined ? { providers: resolvedProviders } : {}),
    ...(options.onRefresh !== undefined ? { onRefresh: options.onRefresh } : {}),
    ...(options.onRefreshError !== undefined ? { onRefreshError: options.onRefreshError } : {}),
  };

  const normalizedResult = normalizeOptions(normalizeInput);

  if (!normalizedResult.success) {
    return failure(
      buildBaseMeta(resolvedSource ?? "provider-then-process-env", options.processEnv),
      normalizedResult.error,
    );
  }

  const normalized = normalizedResult.data;
  const meta = createInitialMeta(normalized);
  let cacheKey: string | undefined;

  try {
    let providerValues: Record<string, unknown> | undefined;
    let processEnvValues: Record<string, string | undefined> | undefined;

    if (sourceUsesProvider(normalized.source)) {
      const aws = normalized.providers.aws;
      if (aws.secretId === undefined || aws.secretId.length === 0) {
        return failure(meta, createError("AWS_SECRET_ID_MISSING"));
      }

      let secretString: string | null = null;
      cacheKey = buildCacheKey(aws.secretId, aws.region);

      if (normalized.cache.enabled) {
        secretString = getCachedSecretString(cacheKey);
        if (secretString !== null) {
          meta.cache.hit = true;
        }
      }

      if (secretString === null) {
        const fetchResult = await fetchSecretString({
          secretId: aws.secretId,
          timeoutMs: normalized.timeoutMs,
          ...(aws.region !== undefined ? { region: aws.region } : {}),
          ...(aws.credentials !== undefined ? { credentials: aws.credentials } : {}),
        });

        if (!fetchResult.success) {
          return failure(meta, fetchResult.error);
        }

        secretString = fetchResult.secretString;

        if (normalized.cache.enabled) {
          setCachedSecretString(cacheKey, secretString, normalized.cache.ttlMs);
        }
      }

      const parsed = parseJsonSecret(secretString);
      if (!parsed.success) {
        return failure(meta, parsed.error);
      }
      providerValues = parsed.data;
    }

    if (sourceUsesProcessEnv(normalized.source)) {
      processEnvValues = snapshotProcessEnv();
    }

    const merged = mergeSources({
      source: normalized.source,
      ...(providerValues !== undefined ? { providerValues } : {}),
      ...(processEnvValues !== undefined ? { processEnvValues } : {}),
    });

    const validation = await validateSchema(options.schema, merged);

    if (!validation.success) {
      return failure(
        meta,
        createError("SCHEMA_VALIDATION_FAILED", {
          issues: validation.issues,
          cause: validation.error,
        }),
      );
    }

    if (normalized.processEnv.mutate) {
      const validatedRecord =
        validation.data && typeof validation.data === "object" && !Array.isArray(validation.data)
          ? (validation.data as Record<string, unknown>)
          : {};
      const mutation = mutateProcessEnv(validatedRecord, normalized.processEnv.overwrite);
      meta.processEnvMutation.writtenKeys = mutation.writtenKeys;
      meta.processEnvMutation.skippedKeys = mutation.skippedKeys;
      if (!mutation.success) {
        return failure(meta, mutation.error);
      }
      meta.processEnvMutation.performed = true;
    }

    const result = success(meta, validation.data);

    if (normalized.cache.autoRefresh && cacheKey !== undefined) {
      const key = cacheKey;
      const tick = makeRefreshTick<TSchema>({
        schema: options.schema,
        normalized,
        cacheKey: key,
        ...(options.onRefresh !== undefined ? { onRefresh: options.onRefresh } : {}),
        ...(options.onRefreshError !== undefined ? { onRefreshError: options.onRefreshError } : {}),
      });
      startAutoRefresh(key, normalized.cache.ttlMs, tick);
      result.stop = () => stopAutoRefresh(key);
    }

    return result;
  } catch (cause) {
    return failure(meta, createError("UNKNOWN", { cause }));
  }
}
