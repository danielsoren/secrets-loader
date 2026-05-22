import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createError } from "../core/errors";
import type { AwsCredentialsOption, LoadSecretsError } from "../core/types";
import { TimeoutError, withTimeout } from "../utils/timeout";
import { createSecretsManagerClient } from "./create-secrets-manager-client";

export type FetchSecretStringInput = {
  secretId: string;
  region?: string;
  credentials?: AwsCredentialsOption;
  timeoutMs: number;
};

export type FetchSecretStringResult =
  | { success: true; secretString: string }
  | { success: false; error: LoadSecretsError };

export async function fetchSecretString(
  input: FetchSecretStringInput,
): Promise<FetchSecretStringResult> {
  const client = createSecretsManagerClient({
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.credentials !== undefined ? { credentials: input.credentials } : {}),
  });

  try {
    const response = await withTimeout(
      client.send(new GetSecretValueCommand({ SecretId: input.secretId })),
      input.timeoutMs,
    );

    const secretString = response.SecretString;
    if (typeof secretString === "string" && secretString.length > 0) {
      return { success: true, secretString };
    }

    if (response.SecretBinary !== undefined) {
      return {
        success: false,
        error: createError("AWS_SECRET_BINARY_UNSUPPORTED"),
      };
    }

    return { success: false, error: createError("AWS_SECRET_EMPTY") };
  } catch (cause) {
    if (cause instanceof TimeoutError) {
      return { success: false, error: createError("TIMEOUT", { cause }) };
    }
    return {
      success: false,
      error: createError("AWS_FETCH_FAILED", { cause }),
    };
  } finally {
    try {
      client.destroy();
    } catch {
      // ignore client destroy errors
    }
  }
}
