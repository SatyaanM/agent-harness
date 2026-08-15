import { describe, expect, it } from "vitest";
import { evaluateSecurityAudit } from "./security-audit.mjs";

const now = new Date("2026-08-11T00:00:00.000Z");

describe("security audit policy", () => {
  it("fails unaccepted high and critical production vulnerabilities", () => {
    const result = evaluateSecurityAudit(
      {
        vulnerabilities: {
          safe: { severity: "moderate" },
          exposed: { severity: "high" },
        },
      },
      { version: 2, exceptions: [] },
      now,
    );

    expect(result.unaccepted).toEqual([{ package: "exposed", severity: "high" }]);
  });

  it("accepts a documented unexpired exception", () => {
    const result = evaluateSecurityAudit(
      {
        vulnerabilities: {
          exposed: { severity: "high", via: [{ source: 123, severity: "high" }] },
        },
      },
      {
        version: 2,
        exceptions: [
          {
            package: "exposed",
            advisory: "123",
            reason: "Upstream fix is under verification.",
            expires: "2026-08-18T00:00:00.000Z",
          },
        ],
      },
      now,
    );

    expect(result).toEqual({ expired: [], unaccepted: [] });
  });

  it("does not let one package exception suppress a different future advisory", () => {
    const result = evaluateSecurityAudit(
      {
        vulnerabilities: {
          exposed: { severity: "critical", via: [{ source: 456, severity: "critical" }] },
        },
      },
      {
        version: 2,
        exceptions: [
          {
            package: "exposed",
            advisory: "123",
            reason: "Only advisory 123 was accepted.",
            expires: "2026-08-18T00:00:00.000Z",
          },
        ],
      },
      now,
    );

    expect(result.unaccepted).toEqual([{ package: "exposed", severity: "critical" }]);
  });

  it("fails expired exceptions even when the current audit is clean", () => {
    const result = evaluateSecurityAudit(
      { vulnerabilities: {} },
      {
        version: 2,
        exceptions: [
          {
            package: "old-package",
            advisory: "123",
            reason: "Historical exception.",
            expires: "2026-08-10T00:00:00.000Z",
          },
        ],
      },
      now,
    );

    expect(result.expired).toHaveLength(1);
  });
});
