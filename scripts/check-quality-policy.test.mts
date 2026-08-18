import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkQualityPolicy } from "./check-quality-policy.mjs";

const tempRoots: string[] = [];

async function makeRepository(options?: {
  baseCompilerOptions?: Record<string, unknown>;
  source?: string;
  sourcePath?: string;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-quality-policy-"));
  tempRoots.push(root);
  await mkdir(path.join(root, "packages", "example", "src"), { recursive: true });
  await writeFile(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { strict: true, ...options?.baseCompilerOptions } }),
  );
  await writeFile(
    path.join(root, "packages", "example", "tsconfig.json"),
    JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src/**/*"] }),
  );
  const sourcePath = path.join(root, options?.sourcePath ?? "packages/example/src/example.ts");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, options?.source ?? "export const answer: number = 42;\n");
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("checkQualityPolicy", () => {
  it("accepts strict TypeScript without forbidden escape hatches", async () => {
    const root = await makeRepository();

    expect(checkQualityPolicy(root)).toEqual([]);
  });

  it("rejects a project that disables strict mode", async () => {
    const root = await makeRepository({ baseCompilerOptions: { strict: false } });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "typescript/strict" }),
    );
  });

  it("rejects an individually weakened strict compiler option", async () => {
    const root = await makeRepository({ baseCompilerOptions: { noImplicitAny: false } });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "typescript/strict-option" }),
    );
  });

  it("checks strict mode in supplemental TypeScript project files", async () => {
    const root = await makeRepository();
    await writeFile(
      path.join(root, "packages", "example", "tsconfig.test.json"),
      JSON.stringify({ compilerOptions: { strict: false }, include: ["src/**/*.ts"] }),
    );

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({
        file: "packages/example/tsconfig.test.json",
        rule: "typescript/strict",
      }),
    );
  });

  it.each([
    [
      "TypeScript ignore directives",
      "// @ts-ignore\nexport const value: number = nope;",
      "typescript/directive",
    ],
    [
      "TypeScript expect-error directives",
      "// @ts-expect-error\nexport const value: number = nope;",
      "typescript/directive",
    ],
    ["explicit any", "export const value: any = 1;", "typescript/no-explicit-any"],
    [
      "single assertions",
      "export const value = ({ ok: true }) as { ok: boolean };",
      "typescript/no-assertion",
    ],
    [
      "double assertions",
      "export const value = ({}) as unknown as { ok: boolean };",
      "typescript/no-double-assertion",
    ],
    [
      "non-null assertions",
      "export const value: string | undefined = 'ok';\nexport const length = value!.length;",
      "typescript/no-non-null-assertion",
    ],
  ])("rejects %s", async (_label, source, rule) => {
    const root = await makeRepository({ source });

    expect(checkQualityPolicy(root)).toContainEqual(expect.objectContaining({ rule }));
  });

  it("rejects direct Express request data access outside the validation helper", async () => {
    const root = await makeRepository({
      sourcePath: "packages/server/src/routes/example.ts",
      source: "export function route(req: { body: unknown }) { return req.body; }",
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/validate-request" }),
    );
  });

  it("allows Express request data to flow directly into the validation helper", async () => {
    const root = await makeRepository({
      sourcePath: "packages/server/src/routes/example.ts",
      source:
        "export function route(req: { body: unknown }, schema: unknown, res: unknown) { return validateRequest(schema, req.body, res); }",
    });

    expect(checkQualityPolicy(root)).toEqual([]);
  });

  it("rejects unwrapped async Express route handlers", async () => {
    const root = await makeRepository({
      sourcePath: "packages/server/src/routes/example.ts",
      source: 'router.get("/", async (_request, response) => { response.json({ ok: true }); });',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "express/handled-async-route" }),
    );
  });

  it("rejects raw JSON parsing in persistence code", async () => {
    const root = await makeRepository({
      sourcePath: "packages/core/src/persistence/example.ts",
      source: "export function load(raw: string) { return JSON.parse(raw); }",
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/validated-json" }),
    );
  });

  it("rejects raw JSON parsing in dashboard code", async () => {
    const root = await makeRepository({
      sourcePath: "packages/dashboard/src/lib/example.ts",
      source: "export function load(raw: string) { return JSON.parse(raw); }",
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/validated-json" }),
    );
  });

  it("rejects unbounded HTTP JSON response parsing", async () => {
    const root = await makeRepository({
      source: "export async function load(response: Response) { return response.json(); }",
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/bounded-json-response" }),
    );
  });

  it("rejects GitHub Actions that use mutable tags", async () => {
    const root = await makeRepository();
    const workflow = path.join(root, ".github", "workflows", "ci.yml");
    await mkdir(path.dirname(workflow), { recursive: true });
    await writeFile(workflow, "steps:\n  - uses: actions/checkout@v4\n");

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "supply-chain/pinned-action" }),
    );
  });

  it("rejects Node imports from the browser-safe core contracts surface", async () => {
    const root = await makeRepository({
      sourcePath: "packages/core/src/contracts/example.ts",
      source: 'import fs from "node:fs";\nexport const exists = fs.existsSync;\n',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/browser-safe-contracts" }),
    );
  });

  it("rejects server or UI imports in core runtime", async () => {
    const root = await makeRepository({
      sourcePath: "packages/core/src/agent/example.ts",
      source: 'import express from "express";\nexport const app = express;\n',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/core-isolation" }),
    );
  });

  it("rejects direct core runtime imports in dashboard", async () => {
    const root = await makeRepository({
      sourcePath: "packages/dashboard/src/components/example.tsx",
      source:
        'import { SessionRuntime } from "@agent-harness/core";\nexport const r = SessionRuntime;\n',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/dashboard-contracts-only" }),
    );
  });

  it("allows @agent-harness/core/contracts imports in dashboard", async () => {
    const root = await makeRepository({
      sourcePath: "packages/dashboard/src/components/example.tsx",
      source:
        'import type { SessionData } from "@agent-harness/core/contracts";\nexport const data: SessionData | undefined = undefined;\n',
    });

    expect(checkQualityPolicy(root)).toEqual([]);
  });

  it("rejects dashboard imports in server", async () => {
    const root = await makeRepository({
      sourcePath: "packages/server/src/routes/example.ts",
      source: 'import { Sidebar } from "@agent-harness/dashboard";\nexport const s = Sidebar;\n',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/server-isolation" }),
    );
  });

  it("rejects direct fs write operations in core outside allowed owners", async () => {
    const root = await makeRepository({
      sourcePath: "packages/core/src/agent/bad-writer.ts",
      source:
        'import fs from "fs-extra";\nexport async function write() { await fs.writeFile("foo", "bar"); }\n',
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "persistence/single-writer-only" }),
    );
  });

  it("rejects wildcard ignore patterns in knip configuration", async () => {
    const root = await makeRepository();
    await writeFile(
      path.join(root, "knip.jsonc"),
      JSON.stringify({
        ignore: ["packages/core/**"],
        workspaces: {
          "packages/server": {
            ignoreDependencies: ["*"],
          },
        },
      }),
    );

    const diagnostics = checkQualityPolicy(root);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        rule: "knip/no-wildcard-ignores",
        file: "knip.jsonc",
      }),
    );
  });
});
