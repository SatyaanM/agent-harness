import { spawnSync } from "node:child_process";

const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";

const mode = process.argv[2] ?? "default";
const commonChecks = [
  [corepack, ["npm", "run", mode === "ci" || mode === "nightly" ? "quality:ci" : "quality"]],
  [corepack, ["npm", "run", "quality:policy"]],
  [corepack, ["npm", "run", "skills:validate"]],
  [corepack, ["npm", "run", "docs:check"]],
  [corepack, ["npm", "run", "secrets:check"]],
  [corepack, ["npm", "run", "typecheck"]],
];
const modeChecks = {
  default: [
    [corepack, ["npm", "test"]],
    [corepack, ["npm", "run", "build"]],
  ],
  fast: [[corepack, ["npm", "test"]]],
  ci: [
    [corepack, ["npm", "run", "test:coverage"]],
    [corepack, ["npm", "run", "build"]],
    [corepack, ["npm", "run", "security:audit"]],
  ],
  nightly: [
    [corepack, ["npm", "run", "test:coverage"]],
    [corepack, ["npm", "run", "build"]],
    [corepack, ["npm", "run", "security:audit"]],
    [corepack, ["npm", "run", "perf:report"]],
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
