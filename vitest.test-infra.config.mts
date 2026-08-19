import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@agent-harness/core": path.resolve(currentDirectory, "packages/core/src/index.ts"),
      "@agent-harness/server": path.resolve(currentDirectory, "packages/server/src/index.ts"),
      "socket.io": path.resolve(currentDirectory, "packages/server/node_modules/socket.io"),
      express: path.resolve(currentDirectory, "packages/server/node_modules/express"),
      cors: path.resolve(currentDirectory, "packages/server/node_modules/cors"),
      helmet: path.resolve(currentDirectory, "packages/server/node_modules/helmet"),
      "socket.io-client": path.resolve(
        currentDirectory,
        "packages/dashboard/node_modules/socket.io-client",
      ),
    },
  },
  test: {
    name: "test-infra",
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.spec.ts"],
  },
});
