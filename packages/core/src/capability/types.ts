import { z } from "zod";
import { CapabilityMatrixSchema } from "../agent/types.js";

export const RegistryEntrySchema = z
  .object({
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    sdk: z.string().min(1).max(256),
    caps: CapabilityMatrixSchema,
    source: z.enum(["manual", "cache", "models.dev", "probe"]),
    probedAt: z.string().datetime(),
  })
  .strict();
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

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

export const ModelsDevResponseSchema = z
  .record(
    z.object({
      tool_call: z.boolean().optional(),
      modalities: z.object({ input: z.array(z.string().max(128)).max(32).optional() }).optional(),
      limit: z.object({ output: z.number().nonnegative().optional() }).optional(),
    }),
  )
  .refine((value) => Object.keys(value).length <= 10_000, "too many model entries");
export type ModelsDevResponse = z.infer<typeof ModelsDevResponseSchema>;
