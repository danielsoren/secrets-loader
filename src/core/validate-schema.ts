import type { z } from "zod";
import type { LoadSecretsIssue } from "./types";

export type ValidateSchemaResult<TData> =
  | { success: true; data: TData }
  | { success: false; issues: LoadSecretsIssue[]; error: z.ZodError };

type ZodLikeIssue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
};

type ZodLikeError = {
  issues: ReadonlyArray<ZodLikeIssue>;
};

export function mapIssues(error: ZodLikeError): LoadSecretsIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((p) => String(p)).join(".");
    return {
      path: path.length === 0 ? "<root>" : path,
      message: issue.message,
    };
  });
}

export async function validateSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): Promise<ValidateSchemaResult<z.output<TSchema>>> {
  const parsed = await schema.safeParseAsync(value);
  if (parsed.success) {
    return { success: true, data: parsed.data as z.output<TSchema> };
  }
  return {
    success: false,
    issues: mapIssues(parsed.error as ZodLikeError),
    error: parsed.error,
  };
}
