import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateSchema } from "../src/core/validate-schema";

describe("validateSchema", () => {
  it("returns coerced data on success", async () => {
    const schema = z.object({ PORT: z.coerce.number() });
    const result = await validateSchema(schema, { PORT: "3000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ PORT: 3000 });
    }
  });

  it("supports async refinement", async () => {
    const schema = z.object({
      TOKEN: z.string().refine(async (value) => value.length > 5),
    });
    const ok = await validateSchema(schema, { TOKEN: "abcdef" });
    expect(ok.success).toBe(true);

    const bad = await validateSchema(schema, { TOKEN: "abc" });
    expect(bad.success).toBe(false);
  });

  it("maps Zod issues into path/message pairs", async () => {
    const schema = z.object({ DATABASE_URL: z.url() });
    const result = await validateSchema(schema, { DATABASE_URL: "not-a-url" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.path).toBe("DATABASE_URL");
      expect(typeof result.issues[0]?.message).toBe("string");
    }
  });

  it("does not include received values in issues", async () => {
    const schema = z.object({ JWT_SECRET: z.string().min(32) });
    const secretValue = "very-secret-token-XYZ";
    const result = await validateSchema(schema, { JWT_SECRET: secretValue });
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const issue of result.issues) {
        expect(issue.message).not.toContain(secretValue);
        expect(issue.path).not.toContain(secretValue);
      }
    }
  });
});
