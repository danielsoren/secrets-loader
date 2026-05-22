import type { z } from "zod";
import { createRefresher } from "../core/auto-refresher";
import { executeLoadCycle } from "../core/execute-load";
import { prepareOptions } from "../core/prepare-options";
import { success } from "../core/result";
import type {
  LoadSecretsError,
  LoadSecretsResult,
  LoadSecretsStoreOptions,
  SecretsStore,
} from "../core/types";
import { createSecretsStore } from "./secrets-store";

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

export async function loadSecretsStore<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
>(
  options: LoadSecretsStoreOptions<TSchema, TBootstrap>,
): Promise<LoadSecretsResult<SecretsStore<z.output<TSchema>>>> {
  const forced: LoadSecretsStoreOptions<TSchema, TBootstrap> = {
    ...options,
    cache: { ...(options.cache ?? {}), enabled: true, autoRefresh: true },
  };

  const prepared = prepareOptions(forced, { forStore: true });
  if (!prepared.success) {
    return prepared.failure;
  }

  const normalized = prepared.normalized;
  const initial = await executeLoadCycle({
    schema: options.schema,
    normalized,
    cacheReadAllowed: true,
  });

  if (!initial.success) {
    return initial;
  }

  const store = createSecretsStore<z.output<TSchema>>(initial.data);

  const onRefreshError = options.onRefreshError as ((error: LoadSecretsError) => void) | undefined;

  const refresher = createRefresher({
    intervalMs: normalized.cache.ttlMs,
    tick: async () => {
      const tickResult = await executeLoadCycle({
        schema: options.schema,
        normalized,
        cacheReadAllowed: false,
      });
      if (tickResult.success) {
        store.dispatch(tickResult.data);
      } else {
        safeInvoke(onRefreshError, tickResult.error);
      }
    },
  });

  store.setStop(() => refresher.stop());

  return success(initial.meta, store);
}
