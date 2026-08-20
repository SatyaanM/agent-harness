import { z } from "zod";
import { isRecord } from "./validation.js";

/**
 * SpanKind mirrors OpenTelemetry SpanKind without SDK dependency.
 */
export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

/**
 * SpanStatusCode mirrors OpenTelemetry StatusCode.
 */
export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export interface SpanStatus {
  readonly code: SpanStatusCode;
  readonly message?: string | undefined;
}

export type AttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type SpanAttributes = Record<string, AttributeValue | undefined>;

export interface SpanEvent {
  readonly name: string;
  readonly time?: number | undefined;
  readonly attributes?: SpanAttributes | undefined;
}

export interface ITraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly traceState?: string | undefined;
}

export interface SpanLink {
  readonly context: ITraceContext;
  readonly attributes?: SpanAttributes | undefined;
}

export interface SpanOptions {
  readonly kind?: SpanKind | undefined;
  readonly attributes?: SpanAttributes | undefined;
  readonly links?: readonly SpanLink[] | undefined;
  readonly startTime?: number | undefined;
  readonly root?: boolean | undefined;
}

export interface ISpan {
  spanContext(): ITraceContext;
  setAttribute(key: string, value: AttributeValue | undefined): this;
  setAttributes(attributes: SpanAttributes): this;
  setStatus(status: SpanStatus): this;
  recordException(exception: Error | unknown, time?: number): this;
  addEvent(name: string, attributes?: SpanAttributes, time?: number): this;
  end(endTime?: number): void;
  isRecording(): boolean;
}

export interface ITracer {
  startSpan(name: string, options?: SpanOptions, parentContext?: ITraceContext): ISpan;
  withSpan<T>(span: ISpan, fn: (span: ISpan) => Promise<T> | T): Promise<T>;
  currentContext(): ITraceContext | undefined;
  currentSpan(): ISpan | undefined;
}

// ---------------------------------------------------------------------------
// W3C Trace Context Validation & Propagation
// ---------------------------------------------------------------------------

const TRACE_PARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export const W3CTraceContext = {
  parseTraceParent(header: string): ITraceContext | undefined {
    const match = TRACE_PARENT_REGEX.exec(header.trim());
    if (!match) return undefined;
    const [, traceId, spanId, traceFlagsStr] = match;
    if (
      !traceId ||
      !spanId ||
      !traceFlagsStr ||
      traceId === "00000000000000000000000000000000" ||
      spanId === "0000000000000000"
    ) {
      return undefined;
    }
    return {
      traceId: traceId.toLowerCase(),
      spanId: spanId.toLowerCase(),
      traceFlags: parseInt(traceFlagsStr, 16),
    };
  },

  serializeTraceParent(context: ITraceContext): string {
    const flags = (context.traceFlags & 0xff).toString(16).padStart(2, "0");
    return `00-${context.traceId.toLowerCase()}-${context.spanId.toLowerCase()}-${flags}`;
  },

  extract(carrier: unknown): ITraceContext | undefined {
    if (!isRecord(carrier)) return undefined;

    const traceparent =
      typeof carrier.traceparent === "string"
        ? carrier.traceparent
        : typeof carrier.Traceparent === "string"
          ? carrier.Traceparent
          : undefined;

    if (!traceparent) return undefined;
    const parsed = W3CTraceContext.parseTraceParent(traceparent);
    if (!parsed) return undefined;

    const tracestate =
      typeof carrier.tracestate === "string"
        ? carrier.tracestate
        : typeof carrier.Tracestate === "string"
          ? carrier.Tracestate
          : undefined;

    if (tracestate) {
      return {
        ...parsed,
        traceState: tracestate,
      };
    }
    return parsed;
  },

  inject(context: ITraceContext, carrier: Record<string, string>): void {
    carrier.traceparent = W3CTraceContext.serializeTraceParent(context);
    if (context.traceState) {
      carrier.tracestate = context.traceState;
    }
  },

  generateTraceId(): string {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },

  generateSpanId(): string {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 8; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },
} as const;

export const W3CTraceParentSchema = z
  .string()
  .regex(TRACE_PARENT_REGEX, "Invalid W3C traceparent header format")
  .refine(
    (header) => W3CTraceContext.parseTraceParent(header) !== undefined,
    "Invalid W3C traceparent: all-zero traceId or spanId is not permitted",
  );

// ---------------------------------------------------------------------------
// Zero-Overhead Noop Implementations
// ---------------------------------------------------------------------------

const NOOP_CONTEXT: ITraceContext = Object.freeze({
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
  traceFlags: 0,
});

export class NoopSpan implements ISpan {
  static readonly instance = new NoopSpan();
  spanContext(): ITraceContext {
    return NOOP_CONTEXT;
  }
  setAttribute(): this {
    return this;
  }
  setAttributes(): this {
    return this;
  }
  setStatus(): this {
    return this;
  }
  recordException(): this {
    return this;
  }
  addEvent(): this {
    return this;
  }
  end(): void {}
  isRecording(): boolean {
    return false;
  }
}

export class NoopTracer implements ITracer {
  static readonly instance = new NoopTracer();
  startSpan(): ISpan {
    return NoopSpan.instance;
  }
  async withSpan<T>(_span: ISpan, fn: (span: ISpan) => Promise<T> | T): Promise<T> {
    return fn(NoopSpan.instance);
  }
  currentContext(): ITraceContext | undefined {
    return undefined;
  }
  currentSpan(): ISpan | undefined {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Global Tracer Registration
// ---------------------------------------------------------------------------

let activeTracer: ITracer = NoopTracer.instance;

export function getTracer(): ITracer {
  return activeTracer;
}

export function setGlobalTracer(tracer: ITracer): void {
  activeTracer = tracer;
}

export function resetGlobalTracer(): void {
  activeTracer = NoopTracer.instance;
}
