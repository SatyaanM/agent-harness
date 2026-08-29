#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const PASS = "\u2705";
const FAIL = "\u274C";
const WARN = "\u26A0\uFE0F";

let exitCode = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.log(`  ${FAIL} ${label} — ${detail}`);
    exitCode = 1;
  }
}

function warn(label, detail) {
  console.log(`  ${WARN} ${label} — ${detail}`);
}

// -- Node.js version ----------------------------------------------
console.log("\nNode.js");
const nodeVersion = process.versions.node;
const [major] = nodeVersion.split(".");
check(
  `Node.js ${nodeVersion}`,
  Number(major) >= 20,
  "Requires Node.js >= 20.0.0.",
);

// -- Environment --------------------------------------------------
console.log("\nEnvironment");
const envPath = path.join(ROOT, ".env");
const envExamplePath = path.join(ROOT, ".env.example");

if (fs.existsSync(envPath)) {
  check(".env file exists", true);

  if (fs.existsSync(envExamplePath)) {
    const exampleContent = fs.readFileSync(envExamplePath, "utf8");
    const envContent = fs.readFileSync(envPath, "utf8");

    const exampleKeys = new Set(
      exampleContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("=")[0]?.trim())
        .filter(Boolean),
    );

    const envKeys = new Set(
      envContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("=")[0]?.trim())
        .filter(Boolean),
    );

    const missing = [...exampleKeys].filter((key) => !envKeys.has(key));
    if (missing.length > 0) {
      warn(".env completeness", `Missing keys: ${missing.join(", ")}`);
    } else {
      check(".env has all keys from .env.example", true);
    }
  }
} else {
  warn(".env file", "Not found. Copy .env.example to .env and configure API keys.");
}

// -- Git Configuration --------------------------------------------
console.log("\nGit");
const gitConfigResult = spawnSync("git", ["config", "--get", "core.autocrlf"], {
  encoding: "utf8",
  cwd: ROOT,
});
const autocrlf = (gitConfigResult.stdout || "").trim();
if (process.platform === "win32") {
  check(
    `core.autocrlf = ${autocrlf || "(not set)"}`,
    autocrlf === "true" || autocrlf === "input",
    "On Windows, setting core.autocrlf=true or input avoids line ending mismatches.",
  );
} else {
  check(
    `core.autocrlf = ${autocrlf || "(not set)"}`,
    autocrlf !== "true",
    "On Unix, use core.autocrlf=input or false.",
  );
}

// -- Ports availability -------------------------------------------
console.log("\nPorts");

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

const port3000Available = await isPortAvailable(3000);
const port3001Available = await isPortAvailable(3001);
check(
  "Port 3000 available (dashboard)",
  port3000Available,
  "Port 3000 is in use. Kill the orphan process or configure a different port.",
);
check(
  "Port 3001 available (server)",
  port3001Available,
  "Port 3001 is in use. Kill the orphan process or configure a different port.",
);

// -- Workspace Dependencies ---------------------------------------
console.log("\nDependencies");
const nodeModulesExists = fs.existsSync(path.join(ROOT, "node_modules"));
check("node_modules installed", nodeModulesExists, "Run npm install / pnpm install.");

// -- Summary ------------------------------------------------------
console.log("");
if (exitCode === 0) {
  console.log(`${PASS} All checks passed. Environment is healthy.\n`);
} else {
  console.log(`${FAIL} Some checks failed. See above for details.\n`);
}

process.exitCode = exitCode;
