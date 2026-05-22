import {
  SecretsManagerClient,
  type SecretsManagerClientConfig,
} from "@aws-sdk/client-secrets-manager";
import type { AwsCredentialsOption } from "../core/types";

export type CreateSecretsManagerClientInput = {
  region?: string;
  credentials?: AwsCredentialsOption;
};

export function createSecretsManagerClient(
  input: CreateSecretsManagerClientInput,
): SecretsManagerClient {
  const config: SecretsManagerClientConfig = {};
  if (input.region !== undefined) {
    config.region = input.region;
  }
  if (input.credentials !== undefined) {
    const { accessKeyId, secretAccessKey, sessionToken } = input.credentials;
    config.credentials =
      sessionToken !== undefined
        ? { accessKeyId, secretAccessKey, sessionToken }
        : { accessKeyId, secretAccessKey };
  }
  return new SecretsManagerClient(config);
}
