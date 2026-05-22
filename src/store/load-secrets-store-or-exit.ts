import type { z } from "zod";
import type { LoadSecretsStoreOptions, SecretsStore } from "../core/types";
import { formatLoadSecretsError } from "../utils/format-error";
import { loadSecretsStore } from "./load-secrets-store";

export async function loadSecretsStoreOrExit<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
>(options: LoadSecretsStoreOptions<TSchema, TBootstrap>): Promise<SecretsStore<z.output<TSchema>>> {
  const result = await loadSecretsStore(options);
  if (result.success) {
    return result.data;
  }
  process.stderr.write(`${formatLoadSecretsError(result.error)}\n`);
  process.exit(1);
}
