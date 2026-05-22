import { describe, expect, it } from "vitest";
import { parseJsonSecret } from "../src/utils/parse-json-secret";

describe("parseJsonSecret", () => {
  it("parses a valid JSON object", () => {
    const result = parseJsonSecret('{"A":"B"}');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ A: "B" });
    }
  });

  it("rejects invalid JSON without leaking content", () => {
    const result = parseJsonSecret("{bad");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_INVALID");
      expect(result.error.message).not.toContain("{bad");
    }
  });

  it("rejects top-level array", () => {
    const result = parseJsonSecret('["A"]');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });

  it("rejects top-level null", () => {
    const result = parseJsonSecret("null");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });

  it("rejects top-level string", () => {
    const result = parseJsonSecret('"secret"');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });

  it("rejects top-level number", () => {
    const result = parseJsonSecret("42");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });

  it("rejects top-level boolean", () => {
    const result = parseJsonSecret("true");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SECRET_JSON_NOT_OBJECT");
    }
  });
});
