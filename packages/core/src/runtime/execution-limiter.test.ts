import { describe, expect, it, vi } from "vitest";
import { ExecutionLimiter } from "./execution-limiter.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized");
      resolvePromise();
    },
  };
}

describe("ExecutionLimiter", () => {
  it("runs no more than the configured number of operations and admits waiters FIFO", async () => {
    const limiter = new ExecutionLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, index) =>
      limiter.run(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    expect(limiter.snapshot()).toEqual({ active: 2, limit: 2, queued: 2, queueLimit: 20 });

    gates[0]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[1]?.resolve();
    gates[2]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    gates[3]?.resolve();

    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3]);
    expect(limiter.snapshot()).toEqual({ active: 0, limit: 2, queued: 0, queueLimit: 20 });
  });

  it("releases a slot after an operation fails", async () => {
    const limiter = new ExecutionLimiter(1);
    const failure = limiter.run(async () => {
      throw new Error("failed");
    });
    const next = limiter.run(async () => "completed");

    await expect(failure).rejects.toThrow("failed");
    await expect(next).resolves.toBe("completed");
    expect(limiter.snapshot().active).toBe(0);
  });

  it("applies a reduced limit to future admissions without cancelling active work", async () => {
    const limiter = new ExecutionLimiter(2);
    const firstGate = deferred();
    const secondGate = deferred();
    const started: string[] = [];
    const first = limiter.run(async () => {
      started.push("first");
      await firstGate.promise;
    });
    const second = limiter.run(async () => {
      started.push("second");
      await secondGate.promise;
    });
    await vi.waitFor(() => expect(started).toHaveLength(2));

    limiter.setLimit(1);
    const third = limiter.run(async () => {
      started.push("third");
    });
    firstGate.resolve();
    await first;
    expect(started).toEqual(["first", "second"]);
    secondGate.resolve();

    await Promise.all([second, third]);
    expect(started).toEqual(["first", "second", "third"]);
  });

  it("rejects new work when the bounded wait queue is full", async () => {
    const limiter = new ExecutionLimiter(1, 1);
    const gate = deferred();
    const first = limiter.run(async () => gate.promise);
    const second = limiter.run(async () => "queued");

    await expect(limiter.run(async () => "rejected")).rejects.toThrow("queue is full");
    gate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, "queued"]);
  });
});
