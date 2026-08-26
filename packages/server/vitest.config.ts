import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    // Ordered array: string-keyed aliases do prefix matching, so
    // "@agent-harness/core" would also swallow "@agent-harness/core/contracts"
    // and resolve it to src/index.ts + "/contracts". The more specific
    // subpath must be listed first.
    alias: [
      {
        find: "@agent-harness/core/contracts",
        replacement: path.resolve(currentDirectory, "../core/src/contracts/index.ts"),
      },
      {
        find: "@agent-harness/core",
        replacement: path.resolve(currentDirectory, "../core/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
