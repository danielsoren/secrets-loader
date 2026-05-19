import type { LoadSecretsError } from "../core/types.js";
import { isPlainRecord } from "./is-plain-record.js";

export type ParseJsonSecretResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: LoadSecretsError };

export function parseJsonSecret(input: string): ParseJsonSecretResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      success: false,
      error: {
        code: "SECRET_JSON_INVALID",
        message: "AWS SecretString must be valid JSON.",
      },
    };
  }

  if (!isPlainRecord(parsed)) {
    return {
      success: false,
      error: {
        code: "SECRET_JSON_NOT_OBJECT",
        message: "AWS SecretString must contain a JSON object.",
      },
    };
  }

  return { success: true, data: parsed };
}
