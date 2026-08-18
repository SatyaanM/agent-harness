export function correlateName(provider: string, model: string, manualMapping?: string): string {
  if (manualMapping) return manualMapping;
  return `${provider}/${model}`;
}
