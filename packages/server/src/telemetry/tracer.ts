import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AttributeValue,
  type ISpan,
  type ITraceContext,
  type ITracer,
  resetGlobalTracer,
  type SpanAttributes,
  type SpanEvent,
  SpanKind,
  type SpanLink,
  type SpanOptions,
  type SpanStatus,
  SpanStatusCode,
  setGlobalTracer,
  W3CTraceContext,
} from "@agent-harness/core";

export interface SpanRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly status: SpanStatus;
  readonly attributes: SpanAttributes;
  readonly events: readonly SpanEvent[];
  readonly links: readonly SpanLink[];
}

export type SpanExporter = (spans: readonly SpanRecord[]) => Promise<void> | void;

export class ServerSpan implements ISpan {
  private readonly _context: ITraceContext;
  private readonly _name: string;
  private readonly _kind: SpanKind;
  private readonly _startTime: number;
  private readonly _links: readonly SpanLink[];
  private readonly _parentSpanId?: string | undefined;
  private _endTime?: number | undefined;
  private _status: SpanStatus = { code: SpanStatusCode.UNSET };
  private readonly _attributes: SpanAttributes = {};
  private readonly _events: SpanEvent[] = [];
  private _ended = false;
  private readonly onEnd?: (span: SpanRecord) => void;

  constructor(
    name: string,
    context: ITraceContext,
    options?: SpanOptions,
    parentSpanId?: string,
    onEnd?: (span: SpanRecord) => void,
  ) {
    this._name = name;
    this._context = context;
    this._kind = options?.kind ?? SpanKind.INTERNAL;
    this._startTime = options?.startTime ?? Date.now();
    this._links = options?.links ? [...options.links] : [];
    this._parentSpanId = parentSpanId;
    this.onEnd = onEnd;

    if (options?.attributes) {
      this.setAttributes(options.attributes);
    }
  }

  spanContext(): ITraceContext {
    return this._context;
  }

  setAttribute(key: string, value: AttributeValue | undefined): this {
    if (!this._ended && value !== undefined) {
      this._attributes[key] = value;
    }
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    if (!this._ended) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          this._attributes[key] = value;
        }
      }
    }
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (!this._ended) {
      this._status = status;
    }
    return this;
  }

  recordException(exception: Error | unknown, time?: number): this {
    if (!this._ended) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.addEvent(
        "exception",
        {
          "exception.type": err.name,
          "exception.message": err.message,
          "exception.stacktrace": err.stack ?? "",
        },
        time,
      );
      this.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    }
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes, time?: number): this {
    if (!this._ended) {
      this._events.push({
        name,
        time: time ?? Date.now(),
        attributes: attributes ? { ...attributes } : undefined,
      });
    }
    return this;
  }

  end(endTime?: number): void {
    if (this._ended) return;
    this._ended = true;
    this._endTime = endTime ?? Date.now();
    const durationMs = Math.max(0, this._endTime - this._startTime);

    if (this.onEnd) {
      this.onEnd({
        traceId: this._context.traceId,
        spanId: this._context.spanId,
        parentSpanId: this._parentSpanId,
        name: this._name,
        kind: this._kind,
        startTime: this._startTime,
        endTime: this._endTime,
        durationMs,
        status: this._status,
        attributes: { ...this._attributes },
        events: [...this._events],
        links: [...this._links],
      });
    }
  }

  isRecording(): boolean {
    return !this._ended;
  }

  toRecord(): SpanRecord {
    const end = this._endTime ?? Date.now();
    return {
      traceId: this._context.traceId,
      spanId: this._context.spanId,
      parentSpanId: this._parentSpanId,
      name: this._name,
      kind: this._kind,
      startTime: this._startTime,
      endTime: this._endTime,
      durationMs: end - this._startTime,
      status: this._status,
      attributes: { ...this._attributes },
      events: [...this._events],
      links: [...this._links],
    };
  }
}

export class ServerTracer implements ITracer {
  private readonly storage = new AsyncLocalStorage<ISpan>();
  private readonly finishedSpans: SpanRecord[] = [];
  public readonly exporter?: SpanExporter | undefined;
  private readonly maxBufferedSpans: number;

  constructor(options?: { exporter?: SpanExporter; maxBufferedSpans?: number }) {
    this.exporter = options?.exporter;
    this.maxBufferedSpans = options?.maxBufferedSpans ?? 10_000;
  }

  startSpan(name: string, options?: SpanOptions, parentContext?: ITraceContext): ISpan {
    const activeSpan = this.storage.getStore();
    const resolvedParentContext = parentContext ?? activeSpan?.spanContext();

    const traceId = resolvedParentContext?.traceId ?? W3CTraceContext.generateTraceId();
    const spanId = W3CTraceContext.generateSpanId();
    const traceFlags = resolvedParentContext?.traceFlags ?? 1;

    const spanContext: ITraceContext = {
      traceId,
      spanId,
      traceFlags,
      traceState: resolvedParentContext?.traceState,
    };

    const span = new ServerSpan(
      name,
      spanContext,
      options,
      resolvedParentContext?.spanId,
      (record) => this.recordFinishedSpan(record),
    );

    return span;
  }

  async withSpan<T>(span: ISpan, fn: (span: ISpan) => Promise<T> | T): Promise<T> {
    return this.storage.run(span, async () => {
      try {
        const result = await fn(span);
        return result;
      } catch (err) {
        span.recordException(err);
        throw err;
      }
    });
  }

  currentContext(): ITraceContext | undefined {
    return this.storage.getStore()?.spanContext();
  }

  currentSpan(): ISpan | undefined {
    return this.storage.getStore();
  }

  getFinishedSpans(): readonly SpanRecord[] {
    return this.finishedSpans;
  }

  clearFinishedSpans(): void {
    this.finishedSpans.length = 0;
  }

  async flush(): Promise<void> {
    if (isFlushableExporter(this.exporter)) {
      await this.exporter.flush();
    }
  }

  private recordFinishedSpan(record: SpanRecord): void {
    if (this.finishedSpans.length < this.maxBufferedSpans) {
      this.finishedSpans.push(record);
    }
    if (this.exporter) {
      void Promise.resolve(this.exporter([record])).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Telemetry Lifecycle Management
// ---------------------------------------------------------------------------

let activeServerTracer: ServerTracer | undefined;

export function initTelemetry(options?: {
  enabled?: boolean;
  exporter?: SpanExporter;
  endpoint?: string;
  maxBatchSize?: number;
  scheduledDelayMillis?: number;
}): ServerTracer | undefined {
  const isEnabled =
    options?.enabled ??
    (process.env.OTEL_ENABLED === "true" || Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT));

  if (!isEnabled) {
    resetGlobalTracer();
    activeServerTracer = undefined;
    return undefined;
  }

  let exporter = options?.exporter;
  const endpoint = options?.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!exporter && endpoint && typeof fetch === "function") {
    exporter = createBatchOtlpHttpExporter(endpoint, {
      maxBatchSize: options?.maxBatchSize,
      scheduledDelayMillis: options?.scheduledDelayMillis,
    });
  }

  activeServerTracer = new ServerTracer({ exporter });
  setGlobalTracer(activeServerTracer);
  return activeServerTracer;
}

export function shutdownTelemetry(): void {
  if (activeServerTracer) {
    if (isFlushableExporter(activeServerTracer.exporter)) {
      void activeServerTracer.exporter.shutdown();
    }
    activeServerTracer.clearFinishedSpans();
    activeServerTracer = undefined;
  }
  resetGlobalTracer();
}

export function getServerTracer(): ServerTracer | undefined {
  return activeServerTracer;
}

function hasFlushMethod(
  value: object,
): value is { flush: () => Promise<void>; shutdown: () => Promise<void> } {
  return (
    "flush" in value &&
    typeof value.flush === "function" &&
    "shutdown" in value &&
    typeof value.shutdown === "function"
  );
}

function isFlushableExporter(exporter: unknown): exporter is FlushableSpanExporter {
  return typeof exporter === "function" && hasFlushMethod(exporter);
}

export interface BatchExporterOptions {
  maxBatchSize?: number;
  scheduledDelayMillis?: number;
}

export interface FlushableSpanExporter {
  (spans: readonly SpanRecord[]): Promise<void> | void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createBatchOtlpHttpExporter(
  endpoint: string,
  options?: BatchExporterOptions,
): FlushableSpanExporter {
  const maxBatchSize = options?.maxBatchSize ?? 50;
  const delayMs = options?.scheduledDelayMillis ?? 500;
  let buffer: SpanRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isShutdown = false;

  const rawExporter = createOtlpHttpExporter(endpoint);

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await rawExporter(batch);
  };

  const exporter: FlushableSpanExporter = Object.assign(
    async (spans: readonly SpanRecord[]) => {
      if (isShutdown) return;
      buffer.push(...spans);
      if (buffer.length >= maxBatchSize) {
        await flush();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          void flush();
        }, delayMs);
        timer.unref?.();
      }
    },
    {
      flush,
      async shutdown(): Promise<void> {
        isShutdown = true;
        await flush();
      },
    },
  );

  return exporter;
}

export function createOtlpHttpExporter(endpoint: string): SpanExporter {
  return async (spans) => {
    try {
      const resourceSpans = [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: process.env.OTEL_SERVICE_NAME || "agent-harness" },
              },
              {
                key: "service.version",
                value: { stringValue: process.env.OTEL_SERVICE_VERSION || "0.1.0" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "agent-harness" },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                name: s.name,
                kind: s.kind,
                startTimeUnixNano: (BigInt(s.startTime) * 1_000_000n).toString(),
                endTimeUnixNano: (BigInt(s.endTime ?? s.startTime) * 1_000_000n).toString(),
                status: {
                  code: s.status.code,
                  message: s.status.message,
                },
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === "string"
                      ? { stringValue: v }
                      : typeof v === "number"
                        ? { intValue: v.toString() }
                        : typeof v === "boolean"
                          ? { boolValue: v }
                          : { stringValue: String(v) },
                })),
              })),
            },
          ],
        },
      ];

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceSpans }),
      });
    } catch {
      // Non-blocking best-effort export
    }
  };
}
