import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: [
      // Ordered array: string-keyed aliases do prefix matching, so
      // "@agent-harness/core" would also swallow "@agent-harness/core/contracts".
      // The more specific subpath must be listed first.
      {
        find: "@agent-harness/core/contracts",
        replacement: path.resolve(currentDirectory, "packages/core/src/contracts/index.ts"),
      },
      {
        find: "@agent-harness/core",
        replacement: path.resolve(currentDirectory, "packages/core/src/index.ts"),
      },
      {
        find: "@agent-harness/server",
        replacement: path.resolve(currentDirectory, "packages/server/src/index.ts"),
      },
      {
        find: "socket.io",
        replacement: path.resolve(currentDirectory, "packages/server/node_modules/socket.io"),
      },
      {
        find: "express",
        replacement: path.resolve(currentDirectory, "packages/server/node_modules/express"),
      },
      {
        find: "cors",
        replacement: path.resolve(currentDirectory, "packages/server/node_modules/cors"),
      },
      {
        find: "helmet",
        replacement: path.resolve(currentDirectory, "packages/server/node_modules/helmet"),
      },
      {
        find: "socket.io-client",
        replacement: path.resolve(
          currentDirectory,
          "packages/dashboard/node_modules/socket.io-client",
        ),
      },
    ],
  },
  test: {
    name: "test-infra",
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts", "test/**/*.spec.ts"],
  },
});
