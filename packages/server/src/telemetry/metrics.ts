import { sanitizeLabelName, sanitizeLabelValue, sanitizeMetricName } from "./sanitization.js";

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricDefinition<TLabels extends string = string> {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType;
  readonly labelNames?: readonly TLabels[] | undefined;
}

export interface HistogramOptions<TLabels extends string = string>
  extends MetricDefinition<TLabels> {
  readonly type: "histogram";
  readonly buckets: readonly number[];
}

export interface Counter<TLabels extends string = string> {
  inc(labels?: Record<TLabels, string>, value?: number): void;
  reset(): void;
  collect(): readonly { labels: Record<string, string>; value: number }[];
}

export interface Gauge<TLabels extends string = string> {
  set(labels: Record<TLabels, string> | undefined, value: number): void;
  inc(labels?: Record<TLabels, string>, value?: number): void;
  dec(labels?: Record<TLabels, string>, value?: number): void;
  setToCurrentTime(labels?: Record<TLabels, string>): void;
  setCallback(
    fn: () => number | readonly { labels: Record<TLabels, string>; value: number }[],
  ): void;
  collect(): readonly { labels: Record<string, string>; value: number }[];
}

export interface Histogram<TLabels extends string = string> {
  observe(labels: Record<TLabels, string> | undefined, value: number): void;
  startTimer(
    labels?: Record<TLabels, string>,
  ): (extraLabels?: Partial<Record<TLabels, string>>) => number;
  collectBuckets(): readonly { labels: Record<string, string>; value: number }[];
  collectSums(): readonly { labels: Record<string, string>; value: number }[];
  collectCounts(): readonly { labels: Record<string, string>; value: number }[];
}

export class MetricCounter<TLabels extends string = string> implements Counter<TLabels> {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(def: MetricDefinition<TLabels>) {
    this.name = sanitizeMetricName(def.name);
    this.help = def.help;
  }

  inc(labels?: Record<TLabels, string>, value = 1): void {
    if (value < 0 || Number.isNaN(value)) {
      throw new RangeError("Counter increment must be a non-negative number");
    }
    const sanitized = sanitizeLabels(labels);
    const key = hashLabels(sanitized);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { labels: sanitized, value });
    }
  }

  reset(): void {
    this.values.clear();
  }

  collect(): readonly { labels: Record<string, string>; value: number }[] {
    return Array.from(this.values.values());
  }
}

export class MetricGauge<TLabels extends string = string> implements Gauge<TLabels> {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, { labels: Record<string, string>; value: number }>();
  private callback?: () => number | readonly { labels: Record<TLabels, string>; value: number }[];

  constructor(def: MetricDefinition<TLabels>) {
    this.name = sanitizeMetricName(def.name);
    this.help = def.help;
  }

  set(labels: Record<TLabels, string> | undefined, value: number): void {
    if (!Number.isFinite(value)) return;
    const sanitized = sanitizeLabels(labels);
    const key = hashLabels(sanitized);
    this.values.set(key, { labels: sanitized, value });
  }

  inc(labels?: Record<TLabels, string>, value = 1): void {
    const sanitized = sanitizeLabels(labels);
    const key = hashLabels(sanitized);
    const current = this.values.get(key)?.value ?? 0;
    this.values.set(key, { labels: sanitized, value: current + value });
  }

  dec(labels?: Record<TLabels, string>, value = 1): void {
    this.inc(labels, -value);
  }

  setToCurrentTime(labels?: Record<TLabels, string>): void {
    this.set(labels, Date.now() / 1000);
  }

  setCallback(
    fn: () => number | readonly { labels: Record<TLabels, string>; value: number }[],
  ): void {
    this.callback = fn;
  }

  collect(): readonly { labels: Record<string, string>; value: number }[] {
    if (this.callback) {
      const res = this.callback();
      if (typeof res === "number") {
        return [{ labels: {}, value: res }];
      }
      return res.map((item) => ({ labels: sanitizeLabels(item.labels), value: item.value }));
    }
    return Array.from(this.values.values());
  }
}

export class MetricHistogram<TLabels extends string = string> implements Histogram<TLabels> {
  readonly name: string;
  readonly help: string;
  readonly buckets: readonly number[];
  private readonly data = new Map<
    string,
    {
      labels: Record<string, string>;
      bucketCounts: number[];
      sum: number;
      count: number;
    }
  >();

  constructor(options: HistogramOptions<TLabels>) {
    this.name = sanitizeMetricName(options.name);
    this.help = options.help;
    this.buckets = [...new Set(options.buckets)].filter((b) => b > 0).sort((a, b) => a - b);
  }

  observe(labels: Record<TLabels, string> | undefined, value: number): void {
    const sanitized = sanitizeLabels(labels);
    this.recordObservation(sanitized, value);
  }

  private recordObservation(sanitized: Record<string, string>, value: number): void {
    if (value < 0 || Number.isNaN(value)) {
      throw new RangeError("Histogram observation must be a non-negative number");
    }
    const key = hashLabels(sanitized);
    let record = this.data.get(key);
    if (!record) {
      record = {
        labels: sanitized,
        sum: 0,
        count: 0,
        bucketCounts: new Array(this.buckets.length + 1).fill(0),
      };
      this.data.set(key, record);
    }

    record.sum += value;
    record.count += 1;

    let bucketIdx = this.buckets.length;
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i];
      if (b !== undefined && value <= b) {
        bucketIdx = i;
        break;
      }
    }
    const currentBucketCount = record.bucketCounts[bucketIdx] ?? 0;
    record.bucketCounts[bucketIdx] = currentBucketCount + 1;
  }

  startTimer(
    labels?: Record<TLabels, string>,
  ): (extraLabels?: Partial<Record<TLabels, string>>) => number {
    const start = process.hrtime.bigint();
    return (extraLabels?: Partial<Record<TLabels, string>>) => {
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1e9;
      const merged: Record<string, string> = {
        ...(labels ? sanitizeLabels(labels) : {}),
        ...(extraLabels ? sanitizeLabels(extraLabels) : {}),
      };
      this.recordObservation(merged, durationSeconds);
      return durationSeconds;
    };
  }

  collectBuckets(): readonly { labels: Record<string, string>; value: number }[] {
    const samples: { labels: Record<string, string>; value: number }[] = [];
    for (const record of this.data.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        const b = this.buckets[i];
        if (b !== undefined) {
          cumulative += record.bucketCounts[i] ?? 0;
          samples.push({
            labels: { ...record.labels, le: b.toString() },
            value: cumulative,
          });
        }
      }
      cumulative += record.bucketCounts[this.buckets.length] ?? 0;
      samples.push({
        labels: { ...record.labels, le: "+Inf" },
        value: cumulative,
      });
    }
    return samples;
  }

  collectSums(): readonly { labels: Record<string, string>; value: number }[] {
    return Array.from(this.data.values()).map((r) => ({ labels: r.labels, value: r.sum }));
  }

  collectCounts(): readonly { labels: Record<string, string>; value: number }[] {
    return Array.from(this.data.values()).map((r) => ({ labels: r.labels, value: r.count }));
  }
}

interface CollectableMetric {
  readonly help: string;
  collect(): readonly { labels: Record<string, string>; value: number }[];
}

interface CollectableHistogram {
  readonly help: string;
  collectBuckets(): readonly { labels: Record<string, string>; value: number }[];
  collectSums(): readonly { labels: Record<string, string>; value: number }[];
  collectCounts(): readonly { labels: Record<string, string>; value: number }[];
}

export class MetricRegistry {
  private readonly counters = new Map<string, CollectableMetric>();
  private readonly gauges = new Map<string, CollectableMetric>();
  private readonly histograms = new Map<string, CollectableHistogram>();

  registerCounter<TLabels extends string>(def: MetricDefinition<TLabels>): Counter<TLabels> {
    const name = sanitizeMetricName(def.name);
    const counter = new MetricCounter(def);
    this.counters.set(name, counter);
    return counter;
  }

  registerGauge<TLabels extends string>(def: MetricDefinition<TLabels>): Gauge<TLabels> {
    const name = sanitizeMetricName(def.name);
    const gauge = new MetricGauge(def);
    this.gauges.set(name, gauge);
    return gauge;
  }

  registerHistogram<TLabels extends string>(
    options: HistogramOptions<TLabels>,
  ): Histogram<TLabels> {
    const name = sanitizeMetricName(options.name);
    const histogram = new MetricHistogram(options);
    this.histograms.set(name, histogram);
    return histogram;
  }

  metrics(options?: { openmetrics?: boolean }): string {
    const lines: string[] = [];

    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const sample of counter.collect()) {
        lines.push(formatSample(name, sample.labels, sample.value));
      }
    }

    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const sample of gauge.collect()) {
        lines.push(formatSample(name, sample.labels, sample.value));
      }
    }

    for (const [name, histogram] of this.histograms) {
      lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const bucketSample of histogram.collectBuckets()) {
        lines.push(formatSample(`${name}_bucket`, bucketSample.labels, bucketSample.value));
      }
      for (const sumSample of histogram.collectSums()) {
        lines.push(formatSample(`${name}_sum`, sumSample.labels, sumSample.value));
      }
      for (const countSample of histogram.collectCounts()) {
        lines.push(formatSample(`${name}_count`, countSample.labels, countSample.value));
      }
    }

    if (options?.openmetrics) {
      lines.push("# EOF");
    }

    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

function hashLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "__root__";
  return keys.map((k) => `${k}=${labels[k]}`).join("|");
}

function sanitizeLabels(labels?: Record<string, string | undefined>): Record<string, string> {
  if (!labels) return {};
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (v !== undefined) {
      res[sanitizeLabelName(k)] = sanitizeLabelValue(v);
    }
  }
  return res;
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const pairs = entries.map(([k, v]) => `${sanitizeLabelName(k)}="${sanitizeLabelValue(v)}"`);
  return `{${pairs.join(",")}}`;
}

function formatSample(
  name: string,
  labels: Record<string, string> | undefined,
  value: number,
): string {
  const labelStr = formatLabels(labels);
  const formattedVal = Number.isFinite(value)
    ? value.toString()
    : value === Number.POSITIVE_INFINITY
      ? "+Inf"
      : "-Inf";
  return `${name}${labelStr} ${formattedVal}`;
}
