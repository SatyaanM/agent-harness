export function correlateName(
  provider: string,
  model: string,
  manualMapping?: string,
): string {
  if (manualMapping) return manualMapping;
  return `${provider}/${model}`;
}

export function matchModelsDevId(
  provider: string,
  model: string,
  availableIds: string[],
  manualMapping?: string,
): string | null {
  if (manualMapping) {
    const normalized = normalize(manualMapping);
    const match = availableIds.find((id) => normalize(id) === normalized);
    return match ?? null;
  }

  const target = normalize(model);
  const prefixed = normalize(`${provider}/${model}`);

  for (const id of availableIds) {
    const normalized = normalize(id);
    if (normalized === target || normalized === prefixed) return id;

    const stripped = normalize(id.split("/").pop() ?? id);
    if (stripped === target) return id;
  }

  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.\-_/]/g, "");
}
