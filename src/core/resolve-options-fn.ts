import { createError } from "./errors";
import type {
  LoadSecretsError,
  ProvidersOption,
  ProvidersOptionOrFn,
  SecretSourceMode,
  SourceOption,
} from "./types";

export type ResolvedResult<TValue> =
  | { success: true; data: TValue }
  | { success: false; error: LoadSecretsError };

export function resolveSource(
  option: SourceOption<unknown> | undefined,
  bootstrap: unknown,
  hasBootstrap: boolean,
): ResolvedResult<SecretSourceMode | undefined> {
  if (option === undefined) {
    return { success: true, data: undefined };
  }
  if (typeof option === "function") {
    if (!hasBootstrap) {
      return { success: false, error: createError("INVALID_OPTIONS") };
    }
    return {
      success: true,
      data: (option as (b: unknown) => SecretSourceMode)(bootstrap),
    };
  }
  return { success: true, data: option };
}

export function resolveProviders(
  option: ProvidersOptionOrFn<unknown> | undefined,
  bootstrap: unknown,
  hasBootstrap: boolean,
): ResolvedResult<ProvidersOption | undefined> {
  if (option === undefined) {
    return { success: true, data: undefined };
  }
  if (typeof option === "function") {
    if (!hasBootstrap) {
      return { success: false, error: createError("INVALID_OPTIONS") };
    }
    return {
      success: true,
      data: (option as (b: unknown) => ProvidersOption | undefined)(bootstrap),
    };
  }
  return { success: true, data: option };
}
