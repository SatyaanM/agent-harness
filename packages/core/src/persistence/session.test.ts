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

  it("lists healthy sessions while preserving and diagnosing an invalid transcript", async () => {
    const { dir, store } = await makeStore();
    await store.save(session());
    const invalidPath = path.join(dir, "broken.json");
    await writeFile(invalidPath, '{"secret": TOP_SECRET}', "utf8");

    const result = await store.listWithDiagnostics();

    expect(result.sessions).toEqual([expect.objectContaining({ sessionId: "session-1" })]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "transcript", record: "broken.json" }),
    ]);
    expect(result.diagnostics[0]?.message).not.toContain("TOP_SECRET");
    expect(result.diagnostics[0]?.message).not.toContain(dir);
    await expect(readFile(invalidPath, "utf8")).resolves.toBe('{"secret": TOP_SECRET}');
  });

  it("keeps a valid transcript listable while diagnosing an invalid mailbox", async () => {
    const { dir, store } = await makeStore();
    await store.save(session());
    const mailboxPath = path.join(dir, "session-1.mailbox.jsonl");
    await writeFile(mailboxPath, '{"secret": TOP_SECRET}\n', "utf8");

    const result = await store.listWithDiagnostics();

    expect(result.sessions).toEqual([expect.objectContaining({ sessionId: "session-1" })]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "mailbox", record: "session-1.mailbox.jsonl" }),
    ]);
    expect(result.diagnostics[0]?.message).not.toContain("TOP_SECRET");
    expect(result.diagnostics[0]?.message).not.toContain(dir);
    await expect(readFile(mailboxPath, "utf8")).resolves.toBe('{"secret": TOP_SECRET}\n');
  });

  it("rejects session identifiers that could escape the sessions directory", async () => {
    const { store } = await makeStore();

    await expect(store.load("../outside")).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("preserves and rejects a corrupt mailbox line instead of silently dropping it", async () => {
    const { dir, store } = await makeStore();
    await store.save(session());
    const mailboxPath = path.join(dir, "session-1.mailbox.jsonl");
    await writeFile(mailboxPath, "{corrupt-json}\n", "utf8");

    await expect(store.drainMailbox("session-1")).rejects.toBeInstanceOf(BoundaryValidationError);
    await expect(readFile(mailboxPath, "utf8")).resolves.toBe("{corrupt-json}\n");
  });

  it("preserves concurrent mailbox appends in submission order and drains them once", async () => {
    const { store } = await makeStore();
    await store.save(session());
    const pending = ["task-1", "task-2", "task-3"].map((taskId, index) => ({
      taskId,
      from: `worker-${index + 1}`,
      agentName: `worker-${index + 1}`,
      status: "done" as const,
      summary: `result-${index + 1}`,
      receivedAt: `2026-08-11T00:0${index}:00.000Z`,
    }));

    await Promise.all(pending.map((message) => store.appendMailbox("session-1", message)));

    await expect(store.drainMailbox("session-1")).resolves.toEqual(pending);
    await expect(store.drainMailbox("session-1")).resolves.toEqual([]);
  });

  it("persists the latest submitted snapshot when saves overlap", async () => {
    const { store } = await makeStore();
    const saves = Array.from({ length: 20 }, (_value, index) =>
      store.save(
        session({
          prompt: `version-${index}`,
          messages: [{ role: "user", content: `version-${index}` }],
        }),
      ),
    );

    await Promise.all(saves);

    await expect(store.load("session-1")).resolves.toEqual(
      expect.objectContaining({ prompt: "version-19" }),
    );
  });
});
