import type { z } from "zod";
import { createRefresher } from "./core/auto-refresher";
import { executeLoadCycle } from "./core/execute-load";
import { prepareOptions } from "./core/prepare-options";
import type {
  LoadSecretsError,
  LoadSecretsMeta,
  LoadSecretsOptions,
  LoadSecretsResult,
} from "./core/types";

function safeInvoke<T extends (...args: never[]) => void>(
  fn: T | undefined,
  ...args: Parameters<T>
): void {
  if (fn === undefined) return;
  try {
    fn(...args);
  } catch {
    // Callback errors are swallowed to keep the refresh loop alive.
  }
}

export async function loadSecrets<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
>(options: LoadSecretsOptions<TSchema, TBootstrap>): Promise<LoadSecretsResult<z.output<TSchema>>> {
  const prepared = prepareOptions(options);
  if (!prepared.success) {
    return prepared.failure;
  }

  const normalized = prepared.normalized;
  const result = await executeLoadCycle({
    schema: options.schema,
    normalized,
    cacheReadAllowed: true,
  });

  if (!result.success) {
    return result;
  }

  if (normalized.cache.autoRefresh && normalized.providers.aws.secretId !== undefined) {
    const onRefresh = options.onRefresh as
      | ((env: z.output<TSchema>, meta: LoadSecretsMeta) => void)
      | undefined;
    const onRefreshError = options.onRefreshError as
      | ((error: LoadSecretsError) => void)
      | undefined;

    const refresher = createRefresher({
      intervalMs: normalized.cache.ttlMs,
      tick: async () => {
        const tickResult = await executeLoadCycle({
          schema: options.schema,
          normalized,
          cacheReadAllowed: false,
        });
        if (tickResult.success) {
          safeInvoke(onRefresh, tickResult.data, tickResult.meta);
        } else {
          safeInvoke(onRefreshError, tickResult.error);
        }
      },
    });

    result.stop = () => refresher.stop();
  }

  return result;
}
