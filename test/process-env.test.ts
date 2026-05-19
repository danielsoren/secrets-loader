import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutateProcessEnv, stringifyForEnv } from "../src/core/process-env.js";

const TEST_KEYS = ["TEST_A", "TEST_B", "TEST_C", "TEST_D", "TEST_E", "TEST_F"];

function clearTestKeys() {
  for (const key of TEST_KEYS) {
    delete process.env[key];
  }
}

describe("stringifyForEnv", () => {
  it("passes through strings", () => {
    expect(stringifyForEnv("hello")).toBe("hello");
  });
  it("converts numbers", () => {
    expect(stringifyForEnv(42)).toBe("42");
  });
  it("converts booleans", () => {
    expect(stringifyForEnv(true)).toBe("true");
    expect(stringifyForEnv(false)).toBe("false");
  });
  it("converts bigint", () => {
    expect(stringifyForEnv(10n)).toBe("10");
  });
  it("converts Date to ISO string", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(stringifyForEnv(date)).toBe("2024-01-01T00:00:00.000Z");
  });
  it("JSON-stringifies objects and arrays", () => {
    expect(stringifyForEnv({ a: 1 })).toBe('{"a":1}');
    expect(stringifyForEnv([1, 2])).toBe("[1,2]");
  });
  it("skips null/undefined", () => {
    expect(stringifyForEnv(null)).toBeNull();
    expect(stringifyForEnv(undefined)).toBeNull();
  });
});

describe("mutateProcessEnv", () => {
  beforeEach(() => {
    clearTestKeys();
  });
  afterEach(() => {
    clearTestKeys();
  });

  it("writes all keys when overwrite is true", () => {
    process.env["TEST_A"] = "old";
    const result = mutateProcessEnv({ TEST_A: "new", TEST_B: 7 }, true);
    expect(result.success).toBe(true);
    expect(process.env["TEST_A"]).toBe("new");
    expect(process.env["TEST_B"]).toBe("7");
    if (result.success) {
      expect(result.writtenKeys.sort()).toEqual(["TEST_A", "TEST_B"]);
    }
  });

  it("skips existing keys when overwrite is false", () => {
    process.env["TEST_A"] = "old";
    const result = mutateProcessEnv({ TEST_A: "new", TEST_B: "added" }, false);
    expect(result.success).toBe(true);
    expect(process.env["TEST_A"]).toBe("old");
    expect(process.env["TEST_B"]).toBe("added");
    if (result.success) {
      expect(result.writtenKeys).toEqual(["TEST_B"]);
      expect(result.skippedKeys).toEqual(["TEST_A"]);
    }
  });

  it("skips null/undefined values", () => {
    const result = mutateProcessEnv({ TEST_A: null, TEST_B: undefined, TEST_C: "x" }, true);
    expect(result.success).toBe(true);
    expect(process.env["TEST_A"]).toBeUndefined();
    expect(process.env["TEST_B"]).toBeUndefined();
    expect(process.env["TEST_C"]).toBe("x");
  });
});
