export interface ExecutionLimiterSnapshot {
  active: number;
  limit: number;
  queued: number;
  queueLimit: number;
}

export class ExecutionQueueFullError extends Error {
  constructor(limit: number) {
    super(`Agent execution queue is full (${limit})`);
    this.name = "ExecutionQueueFullError";
  }
}

/** Process-local FIFO limiter for expensive agent/provider executions. */
export class ExecutionLimiter {
  private active = 0;
  private limit: number;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(
    limit: number,
    private readonly queueLimit = Math.max(10, limit * 10),
  ) {
    this.limit = validateLimit(limit);
    if (!Number.isInteger(queueLimit) || queueLimit < 0) {
      throw new RangeError("Execution queue limit must be a non-negative integer");
    }
  }

  setLimit(limit: number): void {
    this.limit = validateLimit(limit);
    this.admitWaiters();
  }

  snapshot(): ExecutionLimiterSnapshot {
    return {
      active: this.active,
      limit: this.limit,
      queued: this.waiters.length,
      queueLimit: this.queueLimit,
    };
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      if (signal?.aborted) throw abortError();
      return await operation();
    } finally {
      this.active -= 1;
      this.admitWaiters();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.queueLimit) {
      return Promise.reject(new ExecutionQueueFullError(this.queueLimit));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(abortError());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private admitWaiters(): void {
    while (this.active < this.limit) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active += 1;
      waiter.resolve();
    }
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("Execution limit must be a positive integer");
  }
  return limit;
}
