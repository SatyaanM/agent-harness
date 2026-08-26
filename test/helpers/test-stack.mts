import fs from "node:fs";
import http from "node:http";
// IMPORTANT: the server/core modules are loaded through createRequire (CJS
// interop) instead of static ESM imports. Playwright's test runner breaks when
// a worker mixes its CJS-interop transform of `@agent-harness/core` (used by
// statically-importing spec files) with a true ESM load of the same package —
// producing "exports is not defined in ES module scope" or "does not provide
// an export named ..." errors. Loading everything here through require keeps
// a single module identity for the entire server graph.
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Server as SocketIOServer } from "socket.io";

const require_ = createRequire(import.meta.url);

// Type-only imports used solely to derive the shapes returned by require().
type CoreModule = typeof import("@agent-harness/core");
type AppModule = typeof import("../../packages/server/dist/app.js");
type SessionManagerModule = typeof import("../../packages/server/dist/session-manager.js");
type WsEventsModule = typeof import("../../packages/server/dist/ws/events.js");

function requireTyped<T extends object>(spec: string): T {
  // createRequire returns `any`; assigning directly to the typed parameter
  // avoids type assertions (forbidden by the quality policy) while keeping
  // the intended module shape.
  const typed: T = require_(spec);
  if (typeof typed !== "object" || typed === null) {
    throw new Error(`Expected module object from ${spec}`);
  }
  return typed;
}

const core = requireTyped<CoreModule>("@agent-harness/core");
const { createDatabaseConnection, resetConfig } = core;
const serverDist = "../../packages/server/dist/";
const { createApp } = requireTyped<AppModule>(`${serverDist}app.js`);
const { sessionManager } = requireTyped<SessionManagerModule>(`${serverDist}session-manager.js`);
const { initWebSocket } = requireTyped<WsEventsModule>(`${serverDist}ws/events.js`);

import { createFakeProviderServer, type FakeServerInstance } from "../fake-provider/index.js";

export interface EphemeralTestStackOptions {
  customAgents?: Record<string, string>;
  defaultScenario?: string;
  maxConcurrentAgents?: number;
}

export interface EphemeralTestStack {
  tmpDir: string;
  serverPort: number;
  providerPort: number;
  serverUrl: string;
  providerUrl: string;
  fakeProvider: FakeServerInstance;
  dbPath: string;
  getDb: () => ISqliteDatabase;
  teardown: () => Promise<void>;
}

const DEFAULT_ORCHESTRATOR_MD = `---
name: orchestrator
model: DEFAULT
tools:
  - readFile
  - editFile
  - writeFile
  - glob
  - grep
  - delegate
maxSteps: 10
---

You are a lead orchestrator agent in the Agent Harness test suite.
`;

const DEFAULT_RESEARCHER_MD = `---
name: researcher
model: DEFAULT
tools:
  - readFile
  - glob
maxSteps: 5
---

You are a subagent researcher in the Agent Harness test suite.
`;

export async function startEphemeralTestStack(
  options: EphemeralTestStackOptions = {},
): Promise<EphemeralTestStack> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-harness-e2e-"));
  const harnessDir = path.join(tmpDir, ".harness");
  const agentsDir = path.join(tmpDir, "agents");
  const inboxDir = path.join(tmpDir, "inbox");
  const sessionsDir = path.join(tmpDir, "sessions");

  fs.mkdirSync(harnessDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Write default agent configs
  fs.writeFileSync(path.join(agentsDir, "orchestrator.md"), DEFAULT_ORCHESTRATOR_MD, "utf8");
  fs.writeFileSync(path.join(agentsDir, "researcher.md"), DEFAULT_RESEARCHER_MD, "utf8");

  if (options.customAgents) {
    for (const [name, content] of Object.entries(options.customAgents)) {
      fs.writeFileSync(path.join(agentsDir, `${name}.md`), content, "utf8");
    }
  }

  // Start Fake Provider
  const fakeProvider = await createFakeProviderServer({ port: 0 });
  const providerPort = fakeProvider.port;

  // Configure environment variables for this ephemeral test run
  const originalEnv = {
    ROOT: process.env.ROOT,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    PROVIDER_ENDPOINT: process.env.PROVIDER_ENDPOINT,
    OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
    MAX_CONCURRENT_AGENTS: process.env.MAX_CONCURRENT_AGENTS,
    INBOX_ROOT: process.env.INBOX_ROOT,
    SESSIONS_DIR: process.env.SESSIONS_DIR,
    AGENTS_DIR: process.env.AGENTS_DIR,
  };

  process.env.ROOT = tmpDir;
  process.env.HOST = "127.0.0.1";
  process.env.PROVIDER_ENDPOINT = `${fakeProvider.url}/v1`;
  process.env.OPENCODE_API_KEY = "test-e2e-api-key";
  process.env.INBOX_ROOT = inboxDir;
  process.env.SESSIONS_DIR = sessionsDir;
  process.env.AGENTS_DIR = agentsDir;

  if (options.maxConcurrentAgents !== undefined) {
    process.env.MAX_CONCURRENT_AGENTS = String(options.maxConcurrentAgents);
  }

  resetConfig();
  await sessionManager.close();

  // Initialize SessionManager with isolated SQLite DB
  await sessionManager.initialize();

  const app = createApp({
    allowedOrigins: ["*"],
  });

  const server = http.createServer(app);
  const activeSockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  const io = new SocketIOServer(server, {
    cors: { origin: "*" },
  });
  initWebSocket(io);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  const serverPort = typeof address === "object" && address ? address.port : 0;
  process.env.PORT = String(serverPort);

  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const dbPath = path.join(sessionsDir, ".harness", "harness.db");

  let isTornDown = false;

  const teardown = async () => {
    if (isTornDown) return;
    isTornDown = true;

    try {
      io.close();
      for (const s of activeSockets) {
        s.destroy();
      }
      activeSockets.clear();
      if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await new Promise<void>((res) => server.close(() => res()));
    } catch {}

    try {
      await sessionManager.close();
    } catch {}

    try {
      await fakeProvider.close();
    } catch {}

    // Restore environment
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    resetConfig();

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  return {
    tmpDir,
    serverPort,
    providerPort,
    serverUrl,
    providerUrl: fakeProvider.url,
    fakeProvider,
    dbPath,
    getDb: () => createDatabaseConnection(dbPath),
    teardown,
  };
}
