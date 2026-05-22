import type {
  LoadSecretsError,
  LoadSecretsFailure,
  LoadSecretsMeta,
  LoadSecretsSuccess,
} from "./types";

export function success<TData>(meta: LoadSecretsMeta, data: TData): LoadSecretsSuccess<TData> {
  return {
    success: true,
    data,
    error: null,
    meta,
  };
}

export function failure(meta: LoadSecretsMeta, error: LoadSecretsError): LoadSecretsFailure {
  return {
    success: false,
    data: null,
    error,
    meta,
  };
}
