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
  private readonly waiters: Array<() => void> = [];

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

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.admitWaiters();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.queueLimit) {
      return Promise.reject(new ExecutionQueueFullError(this.queueLimit));
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private admitWaiters(): void {
    while (this.active < this.limit) {
      const next = this.waiters.shift();
      if (!next) return;
      this.active += 1;
      next();
    }
  }
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("Execution limit must be a positive integer");
  }
  return limit;
}
