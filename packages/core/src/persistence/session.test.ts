import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoundaryValidationError } from "../validation.js";
import { createSessionData, SessionStore } from "./session.js";

const tempDirs: string[] = [];

async function makeStore(): Promise<{ dir: string; store: SessionStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-harness-session-store-"));
  tempDirs.push(dir);
  return { dir, store: new SessionStore(dir) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SessionStore boundary validation", () => {
  it("round-trips a valid session", async () => {
    const { store } = await makeStore();
    await store.save(createSessionData());

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

  it("rejects a transcript with unknown fields instead of silently dropping them", async () => {
    const { dir, store } = await makeStore();
    const session = createSessionData({ sessionId: "extra" });
    const transcriptPath = path.join(dir, "extra.json");
    await writeFile(transcriptPath, JSON.stringify({ ...session, unknownField: "keep-me" }));

    await expect(store.load("extra")).rejects.toBeInstanceOf(BoundaryValidationError);
    await expect(readFile(transcriptPath, "utf8")).resolves.toContain("unknownField");
  });

  it("lists healthy sessions while preserving and diagnosing an invalid transcript", async () => {
    const { dir, store } = await makeStore();
    await store.save(createSessionData());
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
    await store.save(createSessionData());
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
    await store.save(createSessionData());
    const mailboxPath = path.join(dir, "session-1.mailbox.jsonl");
    await writeFile(mailboxPath, "{corrupt-json}\n", "utf8");

    await expect(store.peekMailbox("session-1")).rejects.toBeInstanceOf(BoundaryValidationError);
    await expect(readFile(mailboxPath, "utf8")).resolves.toBe("{corrupt-json}\n");
  });

  it("preserves concurrent mailbox appends in submission order until acknowledgement", async () => {
    const { store } = await makeStore();
    await store.save(createSessionData());
    const pending = ["task-1", "task-2", "task-3"].map((taskId, index) => ({
      taskId,
      from: `worker-${index + 1}`,
      agentName: `worker-${index + 1}`,
      status: "done" as const,
      summary: `result-${index + 1}`,
      receivedAt: `2026-08-11T00:0${index}:00.000Z`,
    }));

    await Promise.all(pending.map((message) => store.appendMailbox("session-1", message)));

    await expect(store.peekMailbox("session-1")).resolves.toEqual(pending);
    await store.acknowledgeMailbox(
      "session-1",
      pending.map((message) => message.taskId),
    );
    await expect(store.peekMailbox("session-1")).resolves.toEqual([]);
  });

  it("acknowledges only materialized mailbox messages and preserves concurrent appends", async () => {
    const { store } = await makeStore();
    await store.save(createSessionData());
    const first = {
      taskId: "task-1",
      from: "worker-1",
      agentName: "worker-1",
      status: "done" as const,
      summary: "first",
      receivedAt: "2026-08-11T00:01:00.000Z",
    };
    const second = {
      taskId: "task-2",
      from: "worker-2",
      agentName: "worker-2",
      status: "done" as const,
      summary: "second",
      receivedAt: "2026-08-11T00:02:00.000Z",
    };

    await store.appendMailbox("session-1", first);
    await expect(store.peekMailbox("session-1")).resolves.toEqual([first]);
    await store.appendMailbox("session-1", second);
    await store.acknowledgeMailbox("session-1", [first.taskId]);

    await expect(store.peekMailbox("session-1")).resolves.toEqual([second]);
    await store.acknowledgeMailbox("session-1", [first.taskId]);
    await expect(store.peekMailbox("session-1")).resolves.toEqual([second]);
  });

  it("persists the latest submitted snapshot when saves overlap", async () => {
    const { store } = await makeStore();
    const saves = Array.from({ length: 20 }, (_value, index) =>
      store.save(
        createSessionData({
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

  it("does not publish derived metadata before the transcript is durable", async () => {
    const { dir, store } = await makeStore();
    await mkdir(path.join(dir, "failed.json.tmp"));

    await expect(
      store.save(createSessionData({ sessionId: "failed", taskId: "failed-task" })),
    ).rejects.toThrow();

    expect(await store.listMeta()).not.toContainEqual(
      expect.objectContaining({ sessionId: "failed" }),
    );
  });

  it("rejects append when mailbox exceeds maximum message count", async () => {
    const { dir, store } = await makeStore();
    await store.save(createSessionData());
    const validMessage = JSON.stringify({
      taskId: "t-1",
      from: "w",
      agentName: "w",
      status: "done",
      summary: "s",
      receivedAt: "2026-08-11T00:00:00.000Z",
    });
    await writeFile(
      path.join(dir, "session-1.mailbox.jsonl"),
      `${validMessage}\n`.repeat(10_000),
      "utf8",
    );

    await expect(
      store.appendMailbox("session-1", {
        taskId: "overflow",
        from: "w",
        agentName: "w",
        status: "done",
        summary: "s",
        receivedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("rejects append when mailbox exceeds maximum byte size", async () => {
    const { dir, store } = await makeStore();
    await store.save(createSessionData());
    const largeSummary = "a".repeat(1_000_000);
    const line = JSON.stringify({
      taskId: "t-1",
      from: "w",
      agentName: "w",
      status: "done",
      summary: largeSummary,
      receivedAt: "2026-08-11T00:00:00.000Z",
    });
    await writeFile(path.join(dir, "session-1.mailbox.jsonl"), `${line}\n`.repeat(25), "utf8");

    await expect(
      store.appendMailbox("session-1", {
        taskId: "overflow-bytes",
        from: "w",
        agentName: "w",
        status: "done",
        summary: "s",
        receivedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(BoundaryValidationError);
  });

  it("rejects listing when session count exceeds maximum limit", async () => {
    const { store } = await makeStore();
    const mockEntries = Array.from({ length: 10_001 }, (_, i) => ({
      isFile: () => true,
      name: `session-${i}.json`,
    }));
    async function* gen() {
      for (const entry of mockEntries) {
        yield entry;
      }
    }
    const mockDir = {
      [Symbol.asyncIterator]() {
        return gen();
      },
      close: async () => {},
    };
    const fs = await import("fs-extra");
    vi.spyOn(fs.default, "opendir").mockImplementation(async () => mockDir);
    const boundedIo = await import("../filesystem/bounded-io.js");
    vi.spyOn(boundedIo, "readUtf8FileBounded").mockResolvedValue(
      JSON.stringify(createSessionData({ sessionId: "mock" })),
    );

    await expect(store.listWithDiagnostics()).rejects.toBeInstanceOf(BoundaryValidationError);
  });
});
