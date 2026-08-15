import { describe, expect, it } from "vitest";
import { resolveRestoredOpenState } from "./RuntimeSync";

describe("RuntimeSync hydration", () => {
  it("selects active state only from successfully restored sessions", () => {
    expect(
      resolveRestoredOpenState(
        { activeSessionId: "missing", openSessionIds: ["missing", "healthy"] },
        [{ sessionId: "healthy" }],
      ),
    ).toEqual({ activeSessionId: "healthy", openSessionIds: ["healthy"] });
  });

  it("clears active state when no transcript restores", () => {
    expect(
      resolveRestoredOpenState({ activeSessionId: "missing", openSessionIds: ["missing"] }, []),
    ).toEqual({ activeSessionId: null, openSessionIds: [] });
  });
});
