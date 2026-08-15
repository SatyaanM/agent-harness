import { describe, expect, it } from "vitest";
import { pluginCommandId } from "./plugin-command-id";

describe("plugin command identity", () => {
  it("keeps component boundaries unambiguous", () => {
    expect(pluginCommandId("a-b", "c")).not.toBe(pluginCommandId("a", "b-c"));
    expect(pluginCommandId("a:b", "c")).not.toBe(pluginCommandId("a", "b:c"));
  });
});
