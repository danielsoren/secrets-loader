import { createError } from "./errors";
import type { LoadSecretsError } from "./types";

export function snapshotProcessEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

export function stringifyForEnv(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type MutationOutcome = {
  success: true;
  writtenKeys: string[];
  skippedKeys: string[];
};

export type MutationResult =
  | MutationOutcome
  | { success: false; error: LoadSecretsError; writtenKeys: string[]; skippedKeys: string[] };

export function mutateProcessEnv(
  validated: Record<string, unknown>,
  overwrite: boolean,
): MutationResult {
  const candidates: Array<[string, string]> = [];
  const skippedKeys: string[] = [];

  for (const key of Object.keys(validated)) {
    const stringified = stringifyForEnv(validated[key]);
    if (stringified === null) {
      skippedKeys.push(key);
      continue;
    }
    if (!overwrite && Object.hasOwn(process.env, key) && process.env[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }
    candidates.push([key, stringified]);
  }

  const previous = new Map<string, string | undefined>();
  const writtenKeys: string[] = [];

  try {
    for (const [key, value] of candidates) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
      writtenKeys.push(key);
    }
    return { success: true, writtenKeys, skippedKeys };
  } catch (cause) {
    for (const [key, prev] of previous) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
    return {
      success: false,
      error: createError("PROCESS_ENV_WRITE_FAILED", { cause }),
      writtenKeys: [],
      skippedKeys,
    };
  }
}
