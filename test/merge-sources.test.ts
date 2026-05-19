import { describe, expect, it } from "vitest";
import { mergeSources } from "../src/core/merge-sources.js";

describe("mergeSources", () => {
  const aws = { A: "aws-A", B: "aws-B" };
  const env = { B: "env-B", C: "env-C" };

  it("aws-only returns AWS values", () => {
    const result = mergeSources({ source: "aws-only", awsValues: aws, processEnvValues: env });
    expect(result).toEqual({ A: "aws-A", B: "aws-B" });
  });

  it("process-env-only returns process env values", () => {
    const result = mergeSources({
      source: "process-env-only",
      awsValues: aws,
      processEnvValues: env,
    });
    expect(result).toEqual({ B: "env-B", C: "env-C" });
  });

  it("aws-then-process-env: process env overrides AWS", () => {
    const result = mergeSources({
      source: "aws-then-process-env",
      awsValues: aws,
      processEnvValues: env,
    });
    expect(result).toEqual({ A: "aws-A", B: "env-B", C: "env-C" });
  });

  it("process-env-then-aws: AWS overrides process env", () => {
    const result = mergeSources({
      source: "process-env-then-aws",
      awsValues: aws,
      processEnvValues: env,
    });
    expect(result).toEqual({ A: "aws-A", B: "aws-B", C: "env-C" });
  });

  it("handles missing AWS values", () => {
    const result = mergeSources({
      source: "aws-then-process-env",
      processEnvValues: env,
    });
    expect(result).toEqual({ B: "env-B", C: "env-C" });
  });

  it("handles missing process env values", () => {
    const result = mergeSources({
      source: "process-env-then-aws",
      awsValues: aws,
    });
    expect(result).toEqual({ A: "aws-A", B: "aws-B" });
  });
});
