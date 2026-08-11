import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function git(args, options = {}) {
  return spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

const rootResult = git(["rev-parse", "--show-toplevel"]);
if (rootResult.status !== 0) {
  console.error(rootResult.stderr.trim() || "Not inside a Git repository.");
  process.exit(1);
}

const root = rootResult.stdout.trim();
const requiredHooks = ["pre-commit", "pre-push"];
const missingHooks = requiredHooks.filter(
  (name) => !existsSync(path.join(root, "hooks", name)),
);

if (missingHooks.length > 0) {
  console.error(`Cannot install hooks; missing: ${missingHooks.join(", ")}`);
  process.exit(1);
}

const configuredResult = git(
  ["config", "--local", "--get", "core.hooksPath"],
  { cwd: root },
);

if (configuredResult.status !== 0 && configuredResult.status !== 1) {
  console.error(configuredResult.stderr.trim() || "Unable to read core.hooksPath.");
  process.exit(1);
}

const configured = configuredResult.stdout.trim();
const desired = path.join(root, "hooks");
const configuredPath = configured
  ? path.resolve(root, configured)
  : undefined;
const force = process.argv.includes("--force");

if (configuredPath && configuredPath !== desired && !force) {
  console.error(
    `Refusing to replace existing core.hooksPath (${configured}). ` +
      "Re-run with --force only after reviewing that configuration.",
  );
  process.exit(1);
}

const installResult = git(
  ["config", "--local", "core.hooksPath", "hooks"],
  { cwd: root, stdio: "inherit" },
);

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1);
}

console.log("Installed repository hooks via core.hooksPath=hooks.");
