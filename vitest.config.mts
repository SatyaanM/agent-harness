import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
    restoreMocks: true,
    projects: [
      "vitest.tooling.config.mts",
      "vitest.test-infra.config.mts",
      "packages/core/vitest.config.ts",
      "packages/server/vitest.config.ts",
      "packages/dashboard/vitest.config.mts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 24,
        branches: 18,
        functions: 19,
        lines: 26,
      },
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "packages/*/src/**/*.d.ts",
        "packages/*/src/**/*.{test,spec}.{ts,tsx}",
        "packages/dashboard/src/test/**",
      ],
    },
  },
});
