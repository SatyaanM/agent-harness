import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoundaryValidationError } from "../validation.js";
import { type SessionData, SessionStore } from "./session.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: SessionStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-harness-session-store-"));
  tempDirs.push(dir);
  return { dir, store: new SessionStore(dir) };
}

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    sessionId: "session-1",
    taskId: "task-1",
    prompt: "hello",
    messages: [{ role: "user", content: "hello" }],
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SessionStore boundary validation", () => {
  it("round-trips a valid session", async () => {
    const { store } = await makeStore();
    await store.save(session());

    await expect(store.load("session-1")).resolves.toEqual(
      expect.objectContaining({ sessionId: "session-1", mailbox: [] }),
    );
  });

  it("rejects an invalid persisted transcript instead of trusting its shape", async () => {
    const { dir, store } = await makeStore();
    await writeFile(
      path.join(dir, "broken.json"),
      JSON.stringify({ sessionId: "broken", messages: "not-an-array" }),
    );

    await expect(store.load("broken")).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("preserves and rejects a corrupt mailbox line instead of silently dropping it", async () => {
    const { dir, store } = await makeStore();
    await store.save(session());
    const mailboxPath = path.join(dir, "session-1.mailbox.jsonl");
    await writeFile(mailboxPath, "{corrupt-json}\n", "utf8");

    await expect(store.drainMailbox("session-1")).rejects.toBeInstanceOf(BoundaryValidationError);
    await expect(readFile(mailboxPath, "utf8")).resolves.toBe("{corrupt-json}\n");
  });
});
