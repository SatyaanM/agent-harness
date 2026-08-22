const METRIC_NAME_REGEX = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const MAX_LABEL_LENGTH = 128;
const MAX_AGENT_NAME_LENGTH = 64;
const MAX_MODEL_ID_LENGTH = 64;

export function sanitizeMetricName(name: string): string {
  if (!METRIC_NAME_REGEX.test(name)) {
    return name.replace(/[^a-zA-Z0-9_:]/g, "_");
  }
  return name;
}

export function sanitizeLabelName(name: string): string {
  let clean = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(clean)) clean = `_${clean}`;
  return clean;
}

export function sanitizeLabelValue(value: string | undefined): string {
  if (typeof value !== "string") return "unknown";
  const bounded = value.length > MAX_LABEL_LENGTH ? value.slice(0, MAX_LABEL_LENGTH) : value;
  return bounded.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function sanitizeAgentName(name: string | undefined): string {
  if (!name || typeof name !== "string") return "orchestrator";
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_AGENT_NAME_LENGTH);
  return clean.length > 0 ? clean : "orchestrator";
}

export function sanitizeModelId(model: string | undefined): string {
  if (!model || typeof model !== "string") return "unknown";
  const withoutPrefix = model.startsWith("opencode-go/")
    ? model.slice("opencode-go/".length)
    : model;
  const clean =
    withoutPrefix
      .split("?")[0]
      ?.split("@")[0]
      ?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "unknown";
  return clean.slice(0, MAX_MODEL_ID_LENGTH);
}
