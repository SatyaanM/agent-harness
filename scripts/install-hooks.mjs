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

function fail(result, fallback) {
  const message = result.error?.message ?? result.stderr?.trim() ?? fallback;
  console.error(message);
  process.exit(result.status ?? 1);
}

const rootResult = git(["rev-parse", "--show-toplevel"]);
if (rootResult.status !== 0) {
  console.warn("Skipped Git hook setup because this install is not inside a Git repository.");
  process.exit(0);
}

const root = rootResult.stdout.trim();
const configuredResult = git(["config", "--local", "--get", "core.hooksPath"], {
  cwd: root,
});

if (configuredResult.status !== 0 && configuredResult.status !== 1) {
  fail(configuredResult, "Unable to read core.hooksPath.");
}

const configured = configuredResult.stdout.trim();
const configuredPath = configured ? path.resolve(root, configured) : undefined;
const legacyPath = path.resolve(root, "hooks");
const pathsMatch =
  configuredPath &&
  (process.platform === "win32"
    ? configuredPath.toLowerCase() === legacyPath.toLowerCase()
    : configuredPath === legacyPath);

if (pathsMatch) {
  const migrationResult = git(["config", "--local", "--unset", "core.hooksPath"], {
    cwd: root,
    stdio: "inherit",
  });

  if (migrationResult.status !== 0) {
    process.exit(migrationResult.status ?? 1);
  }

  console.log("Removed the legacy core.hooksPath=hooks configuration.");
}

if (process.argv.includes("--migrate-only")) {
  process.exit(0);
}

if (configured && !pathsMatch) {
  console.warn(
    `Skipped Lefthook installation because core.hooksPath is already set to ${configured}.`,
  );
  process.exit(0);
}

const lefthookEntry = path.join(root, "node_modules", "lefthook", "bin", "index.js");
if (!existsSync(lefthookEntry)) {
  console.error("Unable to install Lefthook. Run corepack npm install first.");
  process.exit(1);
}

const installResult = spawnSync(process.execPath, [lefthookEntry, "install"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});

if (installResult.status !== 0) {
  fail(installResult, "Unable to install Lefthook. Run corepack npm install first.");
}
