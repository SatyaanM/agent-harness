import type { TaskId } from "../agent/types.js";

export interface BusMessage {
  from: TaskId;
  content: unknown;
  timestamp: number;
}

type Resolver = (msg: BusMessage) => void;

export class MessageBus {
  private inboxes = new Map<TaskId, BusMessage[]>();
  private waiters = new Map<TaskId, Resolver[]>();

  message(to: TaskId, content: unknown, from: TaskId = "system"): void {
    const msg: BusMessage = { from, content, timestamp: Date.now() };

    const pending = this.waiters.get(to);
    if (pending && pending.length > 0) {
      const resolve = pending.shift();
      if (!resolve) return;
      if (pending.length === 0) this.waiters.delete(to);
      resolve(msg);
      return;
    }

    const inbox = this.inboxes.get(to);
    if (inbox) {
      inbox.push(msg);
    } else {
      this.inboxes.set(to, [msg]);
    }
  }

  readInbox(taskId: TaskId): BusMessage[] {
    const inbox = this.inboxes.get(taskId);
    if (!inbox) return [];
    this.inboxes.delete(taskId);
    return inbox;
  }

  awaitMessage(taskId: TaskId, timeout?: number): Promise<BusMessage> {
    const inbox = this.inboxes.get(taskId);
    if (inbox && inbox.length > 0) {
      const msg = inbox.shift();
      if (!msg) return Promise.reject(new Error("Inbox became empty while reading"));
      if (inbox.length === 0) this.inboxes.delete(taskId);
      return Promise.resolve(msg);
    }

    return new Promise<BusMessage>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const wrappedResolve: Resolver = (msg) => {
        if (timer) clearTimeout(timer);
        resolve(msg);
      };

      if (timeout != null && timeout > 0) {
        timer = setTimeout(() => {
          const waiters = this.waiters.get(taskId);
          if (waiters) {
            const idx = waiters.indexOf(wrappedResolve);
            if (idx !== -1) waiters.splice(idx, 1);
            if (waiters.length === 0) this.waiters.delete(taskId);
          }
          reject(new Error(`awaitMessage timed out after ${timeout}ms`));
        }, timeout);
      }

      const list = this.waiters.get(taskId);
      if (list) {
        list.push(wrappedResolve);
      } else {
        this.waiters.set(taskId, [wrappedResolve]);
      }
    });
  }

  listKnownAgents(): TaskId[] {
    const ids = new Set<TaskId>();
    for (const key of this.inboxes.keys()) ids.add(key);
    for (const key of this.waiters.keys()) ids.add(key);
    return [...ids];
  }
}

export const messageBus = new MessageBus();
