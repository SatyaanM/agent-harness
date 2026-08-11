import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkQualityPolicy } from "./check-quality-policy.mjs";

const tempRoots: string[] = [];

async function makeRepository(options?: {
  baseCompilerOptions?: Record<string, unknown>;
  source?: string;
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
  await writeFile(
    path.join(root, "packages", "example", "src", "example.ts"),
    options?.source ?? "export const answer: number = 42;\n",
  );
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
});
