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

  it.each([
    [
      "TypeScript ignore directives",
      "// @ts-ignore\nexport const value: number = nope;",
      "typescript/directive",
    ],
    ["explicit any", "export const value: any = 1;", "typescript/no-explicit-any"],
    [
      "double assertions",
      "export const value = ({}) as unknown as { ok: boolean };",
      "typescript/no-double-assertion",
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

  it("rejects raw JSON parsing in persistence code", async () => {
    const root = await makeRepository({
      sourcePath: "packages/core/src/persistence/example.ts",
      source: "export function load(raw: string) { return JSON.parse(raw); }",
    });

    expect(checkQualityPolicy(root)).toContainEqual(
      expect.objectContaining({ rule: "boundaries/validated-json" }),
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
});
