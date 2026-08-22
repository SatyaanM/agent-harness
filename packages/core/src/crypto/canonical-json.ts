import { isRecord } from "../validation.js";

/**
 * Serializes any JSON-serializable value into a canonical, deterministic string:
 * - Object keys are sorted lexicographically (UTF-16 code units).
 * - No whitespace around delimiters.
 * - Disallows NaN and Infinity.
 * - Omits undefined, functions, and symbols.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    if (typeof val === "number" && (!Number.isFinite(val) || Number.isNaN(val))) {
      throw new TypeError("Cannot serialize non-finite numbers in canonical JSON");
    }
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalJsonStringify(item ?? null)).join(",")}]`;
  }
  if (!isRecord(val)) {
    return "{}";
  }
  const keys = Object.keys(val).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    const propertyValue = val[key];
    if (
      propertyValue !== undefined &&
      typeof propertyValue !== "function" &&
      typeof propertyValue !== "symbol"
    ) {
      pairs.push(`${JSON.stringify(key)}:${canonicalJsonStringify(propertyValue)}`);
    }
  }
  return `{${pairs.join(",")}}`;
}
