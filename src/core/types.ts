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
  autoRefresh?: boolean;
};

export type ProcessEnvOption = {
  mutate?: boolean;
  overwrite?: boolean;
};

export type SourceOption<TBootstrap> = TBootstrap extends z.ZodTypeAny
  ? SecretSourceMode | ((bootstrap: z.output<TBootstrap>) => SecretSourceMode)
  : SecretSourceMode;

export type ProvidersOptionOrFn<TBootstrap> = TBootstrap extends z.ZodTypeAny
  ? ProvidersOption | ((bootstrap: z.output<TBootstrap>) => ProvidersOption | undefined)
  : ProvidersOption;

export type LoadSecretsOptions<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
> = {
  schema: TSchema;
  bootstrap?: TBootstrap;
  providers?: ProvidersOptionOrFn<TBootstrap>;
  source?: SourceOption<TBootstrap>;
  timeoutMs?: number;
  cache?: CacheOption;
  processEnv?: ProcessEnvOption;
  onRefresh?: (env: z.output<TSchema>, meta: LoadSecretsMeta) => void;
  onRefreshError?: (error: LoadSecretsError) => void;
};

export type LoadSecretsErrorCode =
  | "AWS_SECRET_ID_MISSING"
  | "AWS_FETCH_FAILED"
  | "AWS_SECRET_EMPTY"
  | "AWS_SECRET_BINARY_UNSUPPORTED"
  | "SECRET_JSON_INVALID"
  | "SECRET_JSON_NOT_OBJECT"
  | "SCHEMA_VALIDATION_FAILED"
  | "BOOTSTRAP_VALIDATION_FAILED"
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
    autoRefresh: boolean;
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
  stop?: () => void;
};

export type LoadSecretsFailure = {
  success: false;
  data: null;
  error: LoadSecretsError;
  meta: LoadSecretsMeta;
  stop?: () => void;
};

export type LoadSecretsResult<TData> = LoadSecretsSuccess<TData> | LoadSecretsFailure;

export type Unsubscribe = () => void;

export type SecretsStore<T> = {
  get(): T;
  subscribe(listener: (next: T, prev: T) => void): Unsubscribe;
  stop(): void;
};

export type LoadSecretsStoreOptions<
  TSchema extends z.ZodTypeAny,
  TBootstrap extends z.ZodTypeAny | undefined = undefined,
> = LoadSecretsOptions<TSchema, TBootstrap>;

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
    autoRefresh: boolean;
  };
  processEnv: {
    mutate: boolean;
    overwrite: boolean;
  };
};
