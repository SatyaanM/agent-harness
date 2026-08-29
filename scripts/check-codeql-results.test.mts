import { describe, expect, it } from "vitest";
import { evaluateCodeqlSarif } from "./check-codeql-results.mjs";

describe("CodeQL severity gate", () => {
  it("fails open high and critical security results", () => {
    const findings = evaluateCodeqlSarif({
      runs: [
        {
          tool: {
            driver: {
              rules: [
                { id: "js/high", properties: { "security-severity": "8.1" } },
                { id: "js/critical", properties: { "security-severity": "9.8" } },
              ],
            },
          },
          results: [
            { ruleId: "js/high", ruleIndex: 0, locations: [] },
            { ruleId: "js/critical", ruleIndex: 1, locations: [] },
          ],
        },
      ],
    });

    expect(findings.map(({ ruleId }) => ruleId)).toEqual(["js/high", "js/critical"]);
  });

  it("does not fail medium findings or explicitly suppressed SARIF results", () => {
    const findings = evaluateCodeqlSarif({
      runs: [
        {
          tool: {
            driver: {
              rules: [
                { id: "js/medium", properties: { "security-severity": "6.9" } },
                { id: "js/reviewed", properties: { "security-severity": "8.0" } },
              ],
            },
          },
          results: [
            { ruleId: "js/medium", ruleIndex: 0 },
            {
              ruleId: "js/reviewed",
              ruleIndex: 1,
              suppressions: [{ kind: "inSource", justification: "Narrow reviewed suppression" }],
            },
          ],
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it("treats malformed SARIF as a gate failure", () => {
    expect(() => evaluateCodeqlSarif({ runs: "not-an-array" })).toThrow(/SARIF/);
  });

  it("does not accept workflow-side or unjustified suppressions", () => {
    const findings = evaluateCodeqlSarif({
      runs: [
        {
          tool: {
            driver: {
              rules: [{ id: "js/high", properties: { "security-severity": "8.1" } }],
            },
          },
          results: [
            {
              ruleId: "js/high",
              ruleIndex: 0,
              suppressions: [{ kind: "external", justification: "Not source-reviewed" }],
            },
          ],
        },
      ],
    });

    expect(findings).toHaveLength(1);
  });

  it("falls back to ruleId when ruleIndex is out of range", () => {
    const findings = evaluateCodeqlSarif({
      runs: [
        {
          tool: {
            driver: {
              rules: [{ id: "js/high", properties: { "security-severity": "8.1" } }],
            },
          },
          results: [{ ruleId: "js/high", ruleIndex: 99 }],
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({ ruleId: "js/high", securitySeverity: 8.1 }),
    ]);
  });

  it("uses the matching ruleId when ruleIndex points at a different rule", () => {
    const findings = evaluateCodeqlSarif({
      runs: [
        {
          tool: {
            driver: {
              rules: [
                { id: "js/low", properties: { "security-severity": "2.0" } },
                { id: "js/high", properties: { "security-severity": "8.1" } },
              ],
            },
          },
          results: [{ ruleId: "js/high", ruleIndex: 0 }],
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({ ruleId: "js/high", securitySeverity: 8.1 }),
    ]);
  });

  it("permits ordinary rules without security severity metadata", () => {
    expect(
      evaluateCodeqlSarif({
        runs: [
          {
            tool: { driver: { rules: [{ id: "js/quality" }] } },
            results: [{ ruleId: "js/quality", ruleIndex: 0 }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("fails closed when a result cannot resolve its rule metadata", () => {
    expect(() =>
      evaluateCodeqlSarif({
        runs: [
          {
            tool: { driver: { rules: [] } },
            results: [{ ruleId: "js/missing", ruleIndex: 42 }],
          },
        ],
      }),
    ).toThrow(/cannot resolve rule/i);
  });

  it("fails closed on malformed security severity metadata", () => {
    expect(() =>
      evaluateCodeqlSarif({
        runs: [
          {
            tool: {
              driver: {
                rules: [{ id: "js/high", properties: { "security-severity": "high" } }],
              },
            },
            results: [{ ruleId: "js/high", ruleIndex: 0 }],
          },
        ],
      }),
    ).toThrow(/security-severity/i);
  });

  it("validates rule and severity metadata before honoring an in-source suppression", () => {
    expect(() =>
      evaluateCodeqlSarif({
        runs: [
          {
            tool: {
              driver: {
                rules: [{ id: "js/high", properties: { "security-severity": "invalid" } }],
              },
            },
            results: [
              {
                ruleId: "js/high",
                ruleIndex: 0,
                suppressions: [{ kind: "inSource", justification: "Reviewed source annotation" }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/security-severity/i);
  });
});
