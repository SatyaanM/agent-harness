import type { SessionData } from "@agent-harness/core";

/**
 * Lifecycle hooks (ADR §13).
 *
 * Two families, fixed contract:
 *
 * - **Before-middleware** (`onBefore`): run before an action commits, awaited,
 *   in registration order. May mutate the payload or veto by throwing — the
 *   action then does not happen.
 * - **After-observers** (`on`): run after an action commits, fire-and-forget.
 *   Serialized in registration order by default (race-safety for shared
 *   resources); an observer may opt into `parallel` to bypass the queue and
 *   fire immediately. Errors are logged and isolated — a failing observer never
 *   affects the action's outcome or other observers.
 *
 * Waiting is a property of the event family, never of an individual hook.
 */

export interface SessionOpenedPayload {
  sessionId: string;
  woke: boolean;
  pendingCount: number;
}

export interface SessionClosedPayload {
  sessionId: string;
}

export interface SessionCreatedPayload {
  sessionId: string;
  agentName: string;
}

export interface SessionRenamedPayload {
  sessionId: string;
  title?: string;
}

export interface SessionDeletedPayload {
  sessionId: string;
}

export type LifecyclePayload =
  | SessionOpenedPayload
  | SessionClosedPayload
  | SessionCreatedPayload
  | SessionRenamedPayload
  | SessionDeletedPayload;

export type LifecycleEvent =
  | "session.opened"
  | "session.closed"
  | "session.created"
  | "session.renamed"
  | "session.deleted";

export type BeforeLifecycleEvent = "session.beforeClose" | "session.beforeDelete";

export type LifecycleObserver = (payload: SessionData | LifecyclePayload) => void | Promise<void>;

export interface AfterRegistration {
  handler: LifecycleObserver;
  parallel: boolean;
}

export class HookBus {
  private after = new Map<string, AfterRegistration[]>();
  private afterQueue = new Map<string, Promise<void>>();
  private before = new Map<string, LifecycleObserver[]>();

  /** Register an after-observer. `{ parallel: true }` bypasses the serial queue. */
  on(event: string, handler: LifecycleObserver, options?: { parallel?: boolean }): void {
    const regs = this.after.get(event) ?? [];
    regs.push({ handler, parallel: options?.parallel ?? false });
    this.after.set(event, regs);
  }

  /** Register before-middleware. Awaited, ordered; throwing vetoes the action. */
  onBefore(event: string, handler: LifecycleObserver): void {
    const regs = this.before.get(event) ?? [];
    regs.push(handler);
    this.before.set(event, regs);
  }

  /** Fire after-observers. Never blocks the caller; errors are isolated. */
  emit(event: string, payload: LifecyclePayload): void {
    const regs = this.after.get(event) ?? [];
    for (const reg of regs) {
      if (reg.parallel) {
        void this.runObserver(event, reg.handler, payload);
      } else {
        const prev = this.afterQueue.get(event) ?? Promise.resolve();
        const next = prev.then(() => this.runObserver(event, reg.handler, payload));
        this.afterQueue.set(
          event,
          next.catch(() => undefined),
        );
      }
    }
  }

  /**
   * Run before-middleware for an event. Awaits each in order; a throw
   * propagates to the caller (which must abort the action) and skips the rest.
   */
  async runBefore(event: BeforeLifecycleEvent, payload: LifecyclePayload): Promise<void> {
    const regs = this.before.get(event) ?? [];
    for (const handler of regs) {
      await handler(payload);
    }
  }

  private async runObserver(
    event: string,
    handler: LifecycleObserver,
    payload: LifecyclePayload,
  ): Promise<void> {
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[hooks] ${event} observer failed:`, err);
    }
  }
}

export const hooks = new HookBus();
