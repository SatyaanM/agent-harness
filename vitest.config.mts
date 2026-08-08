import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/server/vitest.config.ts",
      "packages/dashboard/vitest.config.mts",
    ],
  },
});
