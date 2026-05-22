import type { z } from "zod";
import { fetchSecretString } from "../aws/fetch-secret-string";
import { parseJsonSecret } from "../utils/parse-json-secret";
import { buildCacheKey, getCachedSecretString, setCachedSecretString } from "./cache";
import { createError } from "./errors";
import { mergeSources } from "./merge-sources";
import { mutateProcessEnv, snapshotProcessEnv } from "./process-env";
import { sourceUsesProcessEnv, sourceUsesProvider } from "./resolve-source-mode";
import { failure, success } from "./result";
import type {
  LoadSecretsMeta,
  LoadSecretsResult,
  NormalizedOptions,
  SecretSourceMode,
} from "./types";
import { validateSchema } from "./validate-schema";

export type ExecuteLoadCycleInput<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  normalized: NormalizedOptions;
  cacheReadAllowed: boolean;
};

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

export function buildBaseMeta(
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

export async function executeLoadCycle<TSchema extends z.ZodTypeAny>(
  input: ExecuteLoadCycleInput<TSchema>,
): Promise<LoadSecretsResult<z.output<TSchema>>> {
  const { schema, normalized, cacheReadAllowed } = input;
  const meta = createInitialMeta(normalized);

  try {
    let providerValues: Record<string, unknown> | undefined;
    let processEnvValues: Record<string, string | undefined> | undefined;

    let cacheKey: string | undefined;
    let fetchedSecretString: string | undefined;

    if (sourceUsesProvider(normalized.source)) {
      const aws = normalized.providers.aws;
      if (aws.secretId === undefined || aws.secretId.length === 0) {
        return failure(meta, createError("AWS_SECRET_ID_MISSING"));
      }

      cacheKey = buildCacheKey(aws.secretId, aws.region);
      let secretString: string | null = null;

      if (cacheReadAllowed && normalized.cache.enabled) {
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
        fetchedSecretString = secretString;
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

    const validation = await validateSchema(schema, merged);

    if (!validation.success) {
      return failure(
        meta,
        createError("SCHEMA_VALIDATION_FAILED", {
          issues: validation.issues,
          cause: validation.error,
        }),
      );
    }

    // Cache only validated payloads. A failed validation must not persist a bad value.
    if (cacheKey !== undefined && fetchedSecretString !== undefined && normalized.cache.enabled) {
      setCachedSecretString(cacheKey, fetchedSecretString, normalized.cache.ttlMs);
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

    return success(meta, validation.data);
  } catch (cause) {
    return failure(meta, createError("UNKNOWN", { cause }));
  }
}
