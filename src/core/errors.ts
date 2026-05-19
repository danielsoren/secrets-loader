import type { LoadSecretsError, LoadSecretsErrorCode, LoadSecretsIssue } from "./types.js";

const MESSAGES: Record<LoadSecretsErrorCode, string> = {
  AWS_SECRET_ID_MISSING: "AWS secretId is required for the selected source mode.",
  AWS_FETCH_FAILED: "Failed to fetch secret from AWS Secrets Manager.",
  AWS_SECRET_EMPTY: "AWS secret value is empty.",
  AWS_SECRET_BINARY_UNSUPPORTED:
    "SecretBinary is not supported. Store the secret as a JSON object in SecretString.",
  SECRET_JSON_INVALID: "AWS SecretString must be valid JSON.",
  SECRET_JSON_NOT_OBJECT: "AWS SecretString must contain a JSON object.",
  SCHEMA_VALIDATION_FAILED: "Secret validation failed.",
  PROCESS_ENV_WRITE_FAILED: "Failed to write validated secrets to process.env.",
  TIMEOUT: "Timed out while fetching secret from AWS Secrets Manager.",
  INVALID_OPTIONS: "Invalid loadSecrets options.",
  UNKNOWN: "Unexpected error while loading secrets.",
};

export function createError(
  code: LoadSecretsErrorCode,
  options?: { issues?: LoadSecretsIssue[]; cause?: unknown },
): LoadSecretsError {
  const error: LoadSecretsError = {
    code,
    message: MESSAGES[code],
  };
  if (options?.issues !== undefined) {
    error.issues = options.issues;
  }
  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }
  return error;
}
