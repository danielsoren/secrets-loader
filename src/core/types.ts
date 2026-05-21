import type { z } from "zod";

export type SecretSourceMode =
  | "provider-only"
  | "process-env-only"
  | "provider-then-process-env"
  | "process-env-then-provider";

export type AwsCredentialsOption = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type AwsOption = {
  secretId?: string;
  region?: string;
  credentials?: AwsCredentialsOption;
};

export type ProvidersOption = {
  aws?: AwsOption;
};

export type CacheOption = {
  enabled?: boolean;
  ttlMs?: number;
};

export type ProcessEnvOption = {
  mutate?: boolean;
  overwrite?: boolean;
};

export type LoadSecretsOptions<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  providers?: ProvidersOption;
  source?: SecretSourceMode;
  timeoutMs?: number;
  cache?: CacheOption;
  processEnv?: ProcessEnvOption;
};

export type LoadSecretsErrorCode =
  | "AWS_SECRET_ID_MISSING"
  | "AWS_FETCH_FAILED"
  | "AWS_SECRET_EMPTY"
  | "AWS_SECRET_BINARY_UNSUPPORTED"
  | "SECRET_JSON_INVALID"
  | "SECRET_JSON_NOT_OBJECT"
  | "SCHEMA_VALIDATION_FAILED"
  | "PROCESS_ENV_WRITE_FAILED"
  | "TIMEOUT"
  | "INVALID_OPTIONS"
  | "UNKNOWN";

export type LoadSecretsIssue = {
  path: string;
  message: string;
};

export type LoadSecretsError = {
  code: LoadSecretsErrorCode;
  message: string;
  issues?: LoadSecretsIssue[];
  cause?: unknown;
};

export type LoadSecretsMeta = {
  source: SecretSourceMode;
  secretId?: string;
  region?: string;
  loadedAt: Date;
  cache: {
    enabled: boolean;
    hit: boolean;
    ttlMs?: number;
  };
  usedSources: {
    aws: boolean;
    processEnv: boolean;
  };
  processEnvMutation: {
    requested: boolean;
    performed: boolean;
    overwrite: boolean;
    writtenKeys: string[];
    skippedKeys: string[];
  };
};

export type LoadSecretsSuccess<TData> = {
  success: true;
  data: TData;
  error: null;
  meta: LoadSecretsMeta;
};

export type LoadSecretsFailure = {
  success: false;
  data: null;
  error: LoadSecretsError;
  meta: LoadSecretsMeta;
};

export type LoadSecretsResult<TData> = LoadSecretsSuccess<TData> | LoadSecretsFailure;

export type NormalizedOptions = {
  source: SecretSourceMode;
  timeoutMs: number;
  providers: {
    aws: {
      secretId?: string;
      region?: string;
      credentials?: AwsCredentialsOption;
    };
  };
  cache: {
    enabled: boolean;
    ttlMs: number;
  };
  processEnv: {
    mutate: boolean;
    overwrite: boolean;
  };
};
