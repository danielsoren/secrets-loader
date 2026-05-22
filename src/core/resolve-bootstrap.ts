import type { z } from "zod";
import { createError } from "./errors";
import type { LoadSecretsError } from "./types";
import { mapIssues } from "./validate-schema";

type ZodLikeError = {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
};

export type ResolveBootstrapResult<TData> =
  | { success: true; data: TData }
  | { success: false; error: LoadSecretsError };

export function resolveBootstrap<TBootstrap extends z.ZodTypeAny>(
  schema: TBootstrap,
  source: NodeJS.ProcessEnv = process.env,
): ResolveBootstrapResult<z.output<TBootstrap>> {
  const parsed = schema.safeParse(source);
  if (parsed.success) {
    return { success: true, data: parsed.data as z.output<TBootstrap> };
  }
  return {
    success: false,
    error: createError("BOOTSTRAP_VALIDATION_FAILED", {
      issues: mapIssues(parsed.error as ZodLikeError),
      cause: parsed.error,
    }),
  };
}
