import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
const command = ["npm", "run", "build", "--workspace", "@agent-harness/core"];
const build =
  process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", [corepack, ...command].join(" ")],
        {
          cwd: process.cwd(),
          stdio: "inherit",
        },
      )
    : spawnSync(corepack, command, { cwd: process.cwd(), stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const { AgentConfigSchema, parseBoundary } = await import(
  "../packages/core/dist/contracts/index.js"
);
const fixture = {
  name: "benchmark-agent",
  model: "benchmark-model",
  tools: ["readFile", "grep"],
  maxSteps: 20,
  instructions: "Exercise the browser-safe validation contract.",
};
const iterations = 50_000;

for (let index = 0; index < 1_000; index++) {
  parseBoundary(AgentConfigSchema, fixture, "performance warmup");
}
const startedAt = performance.now();
for (let index = 0; index < iterations; index++) {
  parseBoundary(AgentConfigSchema, fixture, "performance sample");
}
const durationMs = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      benchmark: "agent-config-boundary-validation",
      iterations,
      durationMs: Number(durationMs.toFixed(2)),
      operationsPerSecond: Math.round(iterations / (durationMs / 1_000)),
      note: "Informational only; timing thresholds require a stable runner.",
    },
    null,
    2,
  ),
);
