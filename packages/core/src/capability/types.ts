import type { CapabilityMatrix } from "../agent/types.js";

export interface RegistryEntry {
  provider: string;
  model: string;
  sdk: string;
  caps: CapabilityMatrix;
  source: "manual" | "cache" | "models.dev" | "probe";
  probedAt: string;
}

export type CapabilityEntry = RegistryEntry;

export interface AgentConfigRef {
  capabilities?: {
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
    maxTokens?: number;
  };
  modelIdMapping?: string;
}

export interface ModelsDevResponse {
  [key: string]: {
    tool_call?: boolean;
    modalities?: {
      input?: string[];
    };
    limit?: {
      output?: number;
    };
  };
}
