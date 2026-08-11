import { describe, expect, it } from "vitest";
import { buildSubprocessEnvironment } from "./runCommand.js";

describe("runCommand subprocess environment", () => {
  it("keeps required operating-system variables and removes ambient credentials", () => {
    const environment = buildSubprocessEnvironment({
      PATH: "bin",
      SystemRoot: "windows",
      TEMP: "temp",
      OPENCODE_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      RANDOM_VALUE: "hidden",
    });

    expect(environment).toEqual({ PATH: "bin", SystemRoot: "windows", TEMP: "temp" });
  });
});
