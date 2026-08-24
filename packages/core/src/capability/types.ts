import { z } from "zod";
import { CapabilityMatrixSchema } from "../agent/types.js";

export const RegistryEntrySchema = z
  .object({
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    sdk: z.string().min(1).max(256),
    providerConfigId: z.string().min(1).max(2_304).optional(),
    caps: CapabilityMatrixSchema,
    source: z.enum(["manual", "cache", "models.dev", "probe"]),
    probedAt: z.string().datetime(),
  })
  .strict();
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export type CapabilityEntry = RegistryEntry;

export interface AgentConfigRef {
  capabilities?: {
    chat?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
    structuredOutputs?: boolean;
    promptCaching?: boolean;
    reasoning?: boolean;
    maxTokens?: number;
  };
  modelIdMapping?: string;
}

const ModelsDevModelSchema = z
  .object({
    id: z.string().max(512).optional(),
    tool_call: z.boolean().optional(),
    modalities: z.object({ input: z.array(z.string().max(128)).max(32).optional() }).optional(),
    limit: z.object({ output: z.number().nonnegative().optional() }).optional(),
  })
  .passthrough();

const ModelsDevProviderSchema = z
  .object({
    id: z.string().max(512).optional(),
    models: z
      .record(ModelsDevModelSchema)
      .refine((value) => Object.keys(value).length <= 10_000, "too many model entries"),
  })
  .passthrough();

export const ModelsDevResponseSchema = z
  .record(ModelsDevProviderSchema)
  .refine((value) => Object.keys(value).length <= 1_000, "too many provider entries");
export type ModelsDevResponse = z.infer<typeof ModelsDevResponseSchema>;
