import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@agent-harness/core": path.resolve(currentDirectory, "../core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
