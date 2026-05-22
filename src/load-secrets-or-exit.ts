import type { z } from "zod";
import type { LoadSecretsOptions } from "./core/types";
import { loadSecrets } from "./load-secrets";
import { formatLoadSecretsError } from "./utils/format-error";

export async function loadSecretsOrExit<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
>(options: LoadSecretsOptions<TSchema, TBootstrap>): Promise<z.output<TSchema>> {
  const result = await loadSecrets(options);
  if (result.success) {
    return result.data;
  }
  process.stderr.write(`${formatLoadSecretsError(result.error)}\n`);
  process.exit(1);
}
