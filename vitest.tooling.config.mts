import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tooling",
    environment: "node",
    include: ["scripts/**/*.test.mts"],
  },
});
