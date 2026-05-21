import { describe, expect, it } from "vitest";
import { mergeSources } from "../src/core/merge-sources.js";

describe("mergeSources", () => {
  const provider = { A: "aws-A", B: "aws-B" };
  const env = { B: "env-B", C: "env-C" };

  it("provider-only returns provider values", () => {
    const result = mergeSources({
      source: "provider-only",
      providerValues: provider,
      processEnvValues: env,
    });
    expect(result).toEqual({ A: "aws-A", B: "aws-B" });
  });

  it("process-env-only returns process env values", () => {
    const result = mergeSources({
      source: "process-env-only",
      providerValues: provider,
      processEnvValues: env,
    });
    expect(result).toEqual({ B: "env-B", C: "env-C" });
  });

  it("provider-then-process-env: process env overrides provider", () => {
    const result = mergeSources({
      source: "provider-then-process-env",
      providerValues: provider,
      processEnvValues: env,
    });
    expect(result).toEqual({ A: "aws-A", B: "env-B", C: "env-C" });
  });

  it("process-env-then-provider: provider overrides process env", () => {
    const result = mergeSources({
      source: "process-env-then-provider",
      providerValues: provider,
      processEnvValues: env,
    });
    expect(result).toEqual({ A: "aws-A", B: "aws-B", C: "env-C" });
  });

  it("handles missing provider values", () => {
    const result = mergeSources({
      source: "provider-then-process-env",
      processEnvValues: env,
    });
    expect(result).toEqual({ B: "env-B", C: "env-C" });
  });

  it("handles missing process env values", () => {
    const result = mergeSources({
      source: "process-env-then-provider",
      providerValues: provider,
    });
    expect(result).toEqual({ A: "aws-A", B: "aws-B" });
  });
});
