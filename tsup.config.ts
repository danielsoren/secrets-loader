import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "node22",
  platform: "node",
  external: ["zod", "@aws-sdk/client-secrets-manager"],
});
