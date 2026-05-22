import { z } from "zod";
import type { LoadSecretsError } from "../core/types";

export function formatLoadSecretsError(error: LoadSecretsError): string {
  const header = `${error.code}: ${error.message}`;

  if (error.cause instanceof z.ZodError) {
    return `${header}\n${z.prettifyError(error.cause)}`;
  }

  if (error.issues && error.issues.length > 0) {
    const list = error.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
    return `${header}\n${list}`;
  }

  return header;
}
