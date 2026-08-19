import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
const pkgJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const rawManager = pkgJson.packageManager?.split("@")[0];
if (rawManager !== "pnpm") {
  throw new Error(
    `Unsupported packageManager in package.json: "${pkgJson.packageManager}". Only pnpm is supported.`,
  );
}
const pkgManager = "pnpm";

const mode = process.argv[2] ?? "default";
const commonChecks = [
  [corepack, [pkgManager, "run", mode === "ci" || mode === "nightly" ? "quality:ci" : "quality"]],
  [corepack, [pkgManager, "run", "quality:policy"]],
  [corepack, [pkgManager, "run", "skills:validate"]],
  [corepack, [pkgManager, "run", "docs:check"]],
  [corepack, [pkgManager, "run", "secrets:check"]],
  [corepack, [pkgManager, "run", "typecheck"]],
  [corepack, [pkgManager, "run", "knip"]],
];
const modeChecks = {
  default: [
    [corepack, [pkgManager, "test"]],
    [corepack, [pkgManager, "run", "build"]],
  ],
  fast: [[corepack, [pkgManager, "test"]]],
  ci: [
    [corepack, [pkgManager, "run", "test:coverage"]],
    [corepack, [pkgManager, "run", "test:chaos"]],
    [corepack, [pkgManager, "run", "test:security"]],
    [corepack, [pkgManager, "run", "test:load"]],
    [corepack, [pkgManager, "run", "build"]],
    [corepack, [pkgManager, "run", "security:audit"]],
  ],
  nightly: [
    [corepack, [pkgManager, "run", "test:coverage"]],
    [corepack, [pkgManager, "run", "test:chaos"]],
    [corepack, [pkgManager, "run", "test:security"]],
    [corepack, [pkgManager, "run", "test:load"]],
    [corepack, [pkgManager, "run", "build"]],
    [corepack, [pkgManager, "run", "security:audit"]],
    [corepack, [pkgManager, "run", "perf:report"]],
  ],
};

if (!(mode in modeChecks)) {
  console.error(`Unknown check mode: ${mode}`);
  process.exit(1);
}

const checks = [...commonChecks, ...modeChecks[mode], ["git", ["diff", "--check"]]];

function run(command, args) {
  const useCommandShell = process.platform === "win32" && command === corepack;
  const executable = useCommandShell ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs = useCommandShell ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;

  return spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

let exitCode = 0;

for (const [command, args] of checks) {
  const result = run(command, args);

  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    exitCode = 1;
    break;
  }

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
    break;
  }
}

process.exitCode = exitCode;
