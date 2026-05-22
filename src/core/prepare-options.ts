import type { z } from "zod";
import { buildBaseMeta } from "./execute-load";
import { normalizeOptions } from "./normalize-options";
import { resolveBootstrap } from "./resolve-bootstrap";
import { resolveProviders, resolveSource } from "./resolve-options-fn";
import { failure } from "./result";
import type {
  LoadSecretsFailure,
  LoadSecretsOptions,
  NormalizedOptions,
  ProvidersOption,
  SecretSourceMode,
} from "./types";

export type PrepareOptionsResult =
  | { success: true; normalized: NormalizedOptions }
  | { success: false; failure: LoadSecretsFailure };

export type PrepareOptionsContext = {
  forStore?: boolean;
};

export function prepareOptions<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined,
>(
  options: LoadSecretsOptions<TSchema, TBootstrap>,
  context: PrepareOptionsContext = {},
): PrepareOptionsResult {
  let bootstrapData: unknown = undefined;
  const hasBootstrap = options.bootstrap !== undefined;

  if (options.bootstrap !== undefined) {
    const bootstrapResult = resolveBootstrap(options.bootstrap);
    if (!bootstrapResult.success) {
      return {
        success: false,
        failure: failure(
          buildBaseMeta("provider-then-process-env", options.processEnv),
          bootstrapResult.error,
        ),
      };
    }
    bootstrapData = bootstrapResult.data;
  }

  const sourceResult = resolveSource(
    options.source as Parameters<typeof resolveSource>[0],
    bootstrapData,
    hasBootstrap,
  );
  if (!sourceResult.success) {
    return {
      success: false,
      failure: failure(
        buildBaseMeta("provider-then-process-env", options.processEnv),
        sourceResult.error,
      ),
    };
  }

  const providersResult = resolveProviders(
    options.providers as Parameters<typeof resolveProviders>[0],
    bootstrapData,
    hasBootstrap,
  );
  if (!providersResult.success) {
    return {
      success: false,
      failure: failure(
        buildBaseMeta("provider-then-process-env", options.processEnv),
        providersResult.error,
      ),
    };
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

  const normalizedResult = normalizeOptions(normalizeInput, {
    forStore: context.forStore ?? false,
  });

  if (!normalizedResult.success) {
    return {
      success: false,
      failure: failure(
        buildBaseMeta(resolvedSource ?? "provider-then-process-env", options.processEnv),
        normalizedResult.error,
      ),
    };
  }

  return { success: true, normalized: normalizedResult.data };
}
