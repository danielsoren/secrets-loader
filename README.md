# @danielsoren/secrets-loader

Load one JSON secret from a provider, merge local overrides, validate with Zod, and return typed backend config.

> **Provider support:** AWS Secrets Manager today. The API is shaped so other providers (e.g. GCP, Vault) can plug in later without breaking changes.

```ts
import { loadSecrets } from "@danielsoren/secrets-loader";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
});

const result = await loadSecrets({
  schema,
  providers: {
    aws: { secretId: "prod/my-api" },
  },
});

if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

const app = createApp({ env: result.data });
await app.listen(result.data.PORT);
```

## Why this package exists

A managed secret store is a good place to keep backend secrets, but loading them at runtime creates one awkward problem: secrets are async, while app configuration often wants to be available before anything else starts.

This package makes that startup step explicit:

1. fetch one secret from a configured provider (AWS today).
2. parse it as a JSON object.
3. merge it with local `process.env` if configured.
4. validate it with Zod.
5. return a typed result.
6. optionally write validated values to `process.env`.

No import-time magic. No hidden globals. No surprise mutation.

## Requirements

```txt
Node.js >= 22 (Bun >= 1.x also supported)
ESM project
Backend/server runtime
```

This package is not intended for browser/frontend usage.

## Installation

```bash
npm install @danielsoren/secrets-loader zod
```

or:

```bash
pnpm add @danielsoren/secrets-loader zod
```

The AWS provider uses AWS SDK v3 internally. `zod` is a peer dependency.

## Secret format

Store one JSON object as the secret value (`SecretString` in AWS Secrets Manager):

```json
{
  "NODE_ENV": "production",
  "DATABASE_URL": "postgres://user:pass@host:5432/app",
  "JWT_SECRET": "replace-with-a-long-secret",
  "PORT": "3000"
}
```

Top-level arrays, strings, numbers, booleans, and `null` are invalid.

For AWS, `SecretBinary` is not supported in v1.

## Recommended usage: load first, then compose your app

```ts
import { loadSecrets } from "@danielsoren/secrets-loader";
import { z } from "zod";
import { createApp } from "./app.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
});

const result = await loadSecrets({
  schema,
  providers: {
    aws: { secretId: "prod/my-api" },
  },
});

if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

const app = createApp({
  env: result.data,
});

await app.listen(result.data.PORT);
```

Then your application can receive config explicitly:

```ts
import type { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number(),
});

type AppEnv = z.output<typeof schema>;

export function createApp(ctx: { env: AppEnv }) {
  const db = createDb(ctx.env.DATABASE_URL);
  // create routes/services/etc.
}
```

Dependency-injection style is the safest approach: app startup is deterministic and typed.

## Less boilerplate: `loadSecretsOrExit`

Every consumer of `loadSecrets` writes the same five lines: check `result.success`, log the error, exit. `loadSecretsOrExit` collapses that into one call and uses Zod's `prettifyError` to render validation issues clearly.

```ts
import { loadSecretsOrExit } from "@danielsoren/secrets-loader";

const env = await loadSecretsOrExit({
  schema,
  providers: { aws: { secretId: "prod/my-api" } },
});

const app = createApp({ env });
await app.listen(env.PORT);
```

On failure, it writes a formatted message (with sanitized issue paths and messages) to `process.stderr` and calls `process.exit(1)`. The standard `loadSecrets` is still there for callers that want to inspect or recover from errors.

## Bootstrap envs: validate before you load

Loading from a managed provider often needs a few envs *to even know what to load* — `NODE_ENV`, `AWS_SECRETS_ID`, `AWS_REGION`. Pass a `bootstrap` schema and the loader validates those first; `source` and `providers` then become functions of the parsed bootstrap.

```ts
import { loadSecretsOrExit } from "@danielsoren/secrets-loader";
import { z } from "zod";

const bootstrap = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  AWS_SECRETS_ID: z.string().min(1),
  AWS_REGION: z.string().min(1),
});

const schema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
});

const env = await loadSecretsOrExit({
  bootstrap,
  schema,
  source: (b) => (b.NODE_ENV === "production" ? "provider-then-process-env" : "process-env-only"),
  providers: (b) =>
    b.NODE_ENV === "production"
      ? { aws: { secretId: b.AWS_SECRETS_ID, region: b.AWS_REGION } }
      : undefined,
});
```

Notes:

- `bootstrap` is parsed synchronously against `process.env` before anything else runs. On failure you get `code: "BOOTSTRAP_VALIDATION_FAILED"` with `issues[]` populated and the original `ZodError` on `error.cause`.
- The function forms of `source` and `providers` are only accepted at the type level when `bootstrap` is supplied — passing a function without `bootstrap` is a compile error.
- The parsed bootstrap is **not** exposed in `result.meta`. You already have it; the package treats it as your responsibility to keep private.

## Source modes

`loadSecrets` can combine provider values and local `process.env` values.

Default mode:

```ts
"provider-then-process-env"
```

Provider values are loaded first, then local environment variables override them.

| Mode | Provider fetch? | Uses process.env? | Priority |
|---|---:|---:|---|
| `provider-only` | yes | no | provider only |
| `process-env-only` | no | yes | local only |
| `provider-then-process-env` | yes | yes | `process.env` overrides provider |
| `process-env-then-provider` | yes | yes | provider overrides `process.env` |

Example:

```ts
const result = await loadSecrets({
  schema,
  source: "process-env-then-provider",
  providers: {
    aws: { secretId: "prod/my-api" },
  },
});
```

## Local-only mode

Useful for tests, local scripts, or environments where the provider is not available:

```ts
const result = await loadSecrets({
  schema,
  source: "process-env-only",
});
```

In this mode, no provider config is required and no provider is called.

## AWS provider

The AWS provider reads from AWS Secrets Manager. Configure it under `providers.aws`.

### Region and credentials

You can pass a region explicitly:

```ts
const result = await loadSecrets({
  schema,
  providers: {
    aws: {
      secretId: "prod/my-api",
      region: "eu-central-1",
    },
  },
});
```

If `region` is omitted, AWS SDK default region resolution is used.

Credentials are also resolved by AWS SDK by default. You may either omit credentials and use normal AWS SDK mechanisms, or pass explicit credentials through `providers.aws.credentials`.

Normal AWS SDK mechanisms include:

```txt
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
AWS_REGION
AWS_PROFILE
IAM role
ECS task role
EC2 instance role
Lambda execution role
```

You can also pass explicit credentials when needed:

```ts
const result = await loadSecrets({
  schema,
  providers: {
    aws: {
      secretId: "prod/my-api",
      region: "eu-central-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    },
  },
});
```

If `credentials` is omitted, the package does not pass any credential override to AWS SDK. `accessKeyId` and `secretAccessKey` are both required when `credentials` is provided; `sessionToken` is optional.

## Validation and typing

The returned `data` type is inferred from the Zod schema output (`z.output<TSchema>`), so coercions and transforms are reflected in the final type.

```ts
const schema = z.object({
  PORT: z.coerce.number().int().positive(),
});

const result = await loadSecrets({
  schema,
  source: "process-env-only",
});

if (result.success) {
  // number, not string
  result.data.PORT;
}
```

## Result object

`loadSecrets` does not intentionally throw for expected failures. It returns a discriminated union:

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId } },
});

if (result.success) {
  result.data;
  result.meta;
} else {
  result.error.code;
  result.error.message;
  result.error.issues;
}
```

Success:

```ts
{
  success: true,
  data: { DATABASE_URL: "...", PORT: 3000 },
  error: null,
  meta: {
    source: "provider-then-process-env",
    secretId: "prod/my-api",
    loadedAt: new Date(),
    cache: { enabled: false, hit: false },
    usedSources: { aws: true, processEnv: true },
    processEnvMutation: {
      requested: false,
      performed: false,
      overwrite: false,
      writtenKeys: [],
      skippedKeys: [],
    },
  },
}
```

Failure:

```ts
{
  success: false,
  data: null,
  error: {
    code: "SCHEMA_VALIDATION_FAILED",
    message: "Secret validation failed.",
    issues: [{ path: "DATABASE_URL", message: "Invalid URL" }],
  },
  meta: { /* ... */ },
}
```

## Error codes

```ts
type LoadSecretsErrorCode =
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
```

For `SCHEMA_VALIDATION_FAILED` and `BOOTSTRAP_VALIDATION_FAILED`, the original `ZodError` is attached to `error.cause`. You can render it with `z.prettifyError(error.cause)` if you want to do your own formatting; `loadSecretsOrExit` already does this for you.

`AWS_*` codes are emitted when the AWS provider is in use. Future providers will introduce their own prefixed codes alongside these.

Package-generated `message` fields are sanitized and never contain secret values. The optional `cause` field may contain the raw SDK or system error — do not blindly `JSON.stringify(result.error)` into public logs if you cannot trust upstream error contents.

## Legacy interop: process.env mutation

Prefer passing `result.data` to your app explicitly (the dependency-injection pattern shown above). The `processEnv.mutate` option exists for legacy code paths that read directly from `process.env` and cannot be retrofitted.

By default, the package does not write to `process.env`.

You can enable mutation:

```ts
const result = await loadSecrets({
  schema,
  providers: {
    aws: { secretId: "prod/my-api" },
  },
  processEnv: {
    mutate: true,
    overwrite: false,
  },
});
```

Rules:

- mutation happens only after successful validation.
- failed validation writes nothing.
- `overwrite: false` preserves existing environment variables.
- `overwrite: true` replaces existing values.
- `null` and `undefined` values are skipped.

Stringification rules used when writing to `process.env`:

```txt
string  -> same value
number  -> String(value)
boolean -> "true" | "false"
bigint  -> String(value)
Date    -> toISOString()
object  -> JSON.stringify(value)
array   -> JSON.stringify(value)
null/undefined -> skip
```

## Cache and auto-refresh

The cache has two modes:

1. **Memoization only** (`enabled: true`) — subsequent `loadSecrets` calls for the same `(region, secretId)` skip the AWS round-trip while the entry is fresh.
2. **Auto-refresh** (`enabled: true, autoRefresh: true`) — the package re-fetches and re-validates the secret every `ttlMs` in the background and delivers the new env through a callback you provide. You do **not** need to call `loadSecrets` again.

Auto-refresh is the mode that pays off for the recommended one-shot startup pattern: load once, register a callback, let the package keep your env current.

```ts
import { loadSecrets } from "@danielsoren/secrets-loader";

const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/my-api" } },
  cache: { enabled: true, ttlMs: 60_000, autoRefresh: true },
  onRefresh: (env, meta) => {
    // Wire the new env into wherever your app holds config — DB pool reconfig,
    // cached client rebuilds, feature-flag store updates, etc.
    updateAppEnv(env);
  },
  onRefreshError: (error) => {
    log.warn({ code: error.code, message: error.message }, "secret refresh failed");
  },
});

if (!result.success) {
  process.exit(1);
}

const env = result.data;          // initial snapshot
const app = createApp({ getEnv: () => currentEnv });

// Graceful shutdown — clear the refresh timer.
process.on("SIGTERM", () => result.stop?.());
```

Rules:

- `autoRefresh: true` requires `cache.enabled: true` and **at least one** of: `onRefresh` callback, or `processEnv.mutate: true`. Otherwise the call fails with `INVALID_OPTIONS` — auto-refresh has no place to put new values.
- If `processEnv.mutate: true` is set alongside `autoRefresh`, each successful refresh also rewrites `process.env` (subject to the same overwrite rules as the initial load).
- If a refresh fails (AWS down, validation rejects the new payload, etc.), `onRefreshError` is called and the cached value is **not** updated. The next tick fires on schedule — there is no backoff in v1.
- If a refresh tick is still in flight when the next interval fires, the new tick is skipped.
- Calling `loadSecrets` twice for the same `(region, secretId)` with `autoRefresh` replaces the prior timer rather than stacking.
- `result.stop()` clears the timer for that secret. The timer is `setInterval(...).unref()`, so it never blocks process exit on its own, but explicit teardown is still recommended in tests and graceful-shutdown paths.
- `stopAllAutoRefresh()` is exported for test teardown and emergency stops:

```ts
import { stopAllAutoRefresh } from "@danielsoren/secrets-loader";

afterEach(() => stopAllAutoRefresh());
```

Security note: enabling the cache keeps the secret string in process memory.

## Timeout

Default provider fetch timeout:

```ts
5000 // milliseconds
```

Override:

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/my-api" } },
  timeoutMs: 10_000,
});
```

If the timeout is reached, the error code is `"TIMEOUT"`.

## Framework examples

### Hono

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/api" } },
});
if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

const app = new Hono<{ Variables: { env: typeof result.data } }>();
app.use("*", async (c, next) => {
  c.set("env", result.data);
  await next();
});
```

### Express

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/api" } },
});
if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

const app = express();
const env = result.data;

app.get("/health", (_req, res) => {
  res.json({ env: env.NODE_ENV });
});

app.listen(env.PORT);
```

### Generic service composition

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/worker" } },
});
if (!result.success) {
  console.error(result.error.message);
  process.exit(1);
}

const worker = createWorker({
  env: result.data,
  db: createDb(result.data.DATABASE_URL),
});

await worker.start();
```

## Recommended IAM policy (AWS)

Prefer least privilege:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:prod/my-api-*"
}
```

## Security notes

- Do not use this package in frontend code.
- Do not embed loaded secrets into frontend bundles.
- Do not log `result.data`.
- Do not log raw provider errors if your logging pipeline is public or shared.
- Package-generated error messages are sanitized and do not include secret values.
- `process.env` mutation is off by default.
- Cache is off by default.
- The package has no import-time side effects.

## Limitations

v1 intentionally does not support:

- multiple secrets in one call.
- providers other than AWS Secrets Manager.
- AWS `SecretBinary`.
- custom AWS endpoints.
- LocalStack-specific configuration.
- browser usage.
- CommonJS.
- throwing mode.
- automatic import-time loading.

## Roadmap

The `providers.aws` shape is designed so additional providers can be added without breaking the existing API. Likely future additions:

- additional cloud providers (e.g. GCP Secret Manager, HashiCorp Vault).
- custom provider injection.

These are not implemented yet.

## Bad patterns to avoid

Avoid async global initialization soup:

```ts
// avoid
export let env;

loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/api" } },
}).then((result) => {
  if (result.success) {
    env = result.data;
  }
});
```

Prefer explicit startup:

```ts
const result = await loadSecrets({
  schema,
  providers: { aws: { secretId: "prod/api" } },
});

if (!result.success) {
  process.exit(1);
}

await startApp(result.data);
```

## License

MIT
