import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@agent-harness/core/contracts",
        replacement: path.resolve(currentDirectory, "../core/src/contracts/index.ts"),
      },
      {
        find: "@agent-harness/core",
        replacement: path.resolve(currentDirectory, "../core/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(currentDirectory, "src") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
