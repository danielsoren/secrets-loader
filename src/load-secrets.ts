import type { z } from "zod";
import { fetchSecretString } from "./aws/fetch-secret-string.js";
import { buildCacheKey, getCachedSecretString, setCachedSecretString } from "./core/cache.js";
import { createError } from "./core/errors.js";
import { mergeSources } from "./core/merge-sources.js";
import { normalizeOptions } from "./core/normalize-options.js";
import { mutateProcessEnv, snapshotProcessEnv } from "./core/process-env.js";
import { sourceUsesAws, sourceUsesProcessEnv } from "./core/resolve-source-mode.js";
import { failure, success } from "./core/result.js";
import type {
  LoadSecretsMeta,
  LoadSecretsOptions,
  LoadSecretsResult,
  NormalizedOptions,
} from "./core/types.js";
import { validateSchema } from "./core/validate-schema.js";
import { parseJsonSecret } from "./utils/parse-json-secret.js";

function createInitialMeta(normalized: NormalizedOptions): LoadSecretsMeta {
  const meta: LoadSecretsMeta = {
    source: normalized.source,
    loadedAt: new Date(),
    cache: {
      enabled: normalized.cache.enabled,
      hit: false,
    },
    usedSources: {
      aws: sourceUsesAws(normalized.source),
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
  if (normalized.aws.secretId !== undefined) {
    meta.secretId = normalized.aws.secretId;
  }
  if (normalized.aws.region !== undefined) {
    meta.region = normalized.aws.region;
  }
  if (normalized.cache.enabled) {
    meta.cache.ttlMs = normalized.cache.ttlMs;
  }
  return meta;
}

export async function loadSecrets<TSchema extends z.ZodTypeAny>(
  options: LoadSecretsOptions<TSchema>,
): Promise<LoadSecretsResult<z.output<TSchema>>> {
  const normalizedResult = normalizeOptions(options);

  if (!normalizedResult.success) {
    const baseMeta: LoadSecretsMeta = {
      source: options.source ?? "aws-then-process-env",
      loadedAt: new Date(),
      cache: { enabled: false, hit: false },
      usedSources: {
        aws: sourceUsesAws(options.source ?? "aws-then-process-env"),
        processEnv: sourceUsesProcessEnv(options.source ?? "aws-then-process-env"),
      },
      processEnvMutation: {
        requested: options.processEnv?.mutate ?? false,
        performed: false,
        overwrite: options.processEnv?.overwrite ?? false,
        writtenKeys: [],
        skippedKeys: [],
      },
    };
    return failure(baseMeta, normalizedResult.error);
  }

  const normalized = normalizedResult.data;
  const meta = createInitialMeta(normalized);

  try {
    let awsValues: Record<string, unknown> | undefined;
    let processEnvValues: Record<string, string | undefined> | undefined;

    if (sourceUsesAws(normalized.source)) {
      if (normalized.aws.secretId === undefined || normalized.aws.secretId.length === 0) {
        return failure(meta, createError("AWS_SECRET_ID_MISSING"));
      }

      let secretString: string | null = null;
      const cacheKey = buildCacheKey(normalized.aws.secretId, normalized.aws.region);

      if (normalized.cache.enabled) {
        secretString = getCachedSecretString(cacheKey);
        if (secretString !== null) {
          meta.cache.hit = true;
        }
      }

      if (secretString === null) {
        const fetchResult = await fetchSecretString({
          secretId: normalized.aws.secretId,
          timeoutMs: normalized.timeoutMs,
          ...(normalized.aws.region !== undefined ? { region: normalized.aws.region } : {}),
          ...(normalized.aws.credentials !== undefined
            ? { credentials: normalized.aws.credentials }
            : {}),
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
      awsValues = parsed.data;
    }

    if (sourceUsesProcessEnv(normalized.source)) {
      processEnvValues = snapshotProcessEnv();
    }

    const merged = mergeSources({
      source: normalized.source,
      ...(awsValues !== undefined ? { awsValues } : {}),
      ...(processEnvValues !== undefined ? { processEnvValues } : {}),
    });

    const validation = await validateSchema(options.schema, merged);

    if (!validation.success) {
      return failure(meta, createError("SCHEMA_VALIDATION_FAILED", { issues: validation.issues }));
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
