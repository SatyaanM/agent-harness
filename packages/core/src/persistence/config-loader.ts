import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import fg from "fast-glob";
import { z } from "zod";
import type { AgentConfig, CapabilityMatrix } from "../agent/types.js";

const CapabilityMatrixSchema = z.object({
  chat: z.boolean().optional().default(true),
  tools: z.boolean().optional().default(true),
  vision: z.boolean().optional().default(false),
  streaming: z.boolean().optional().default(true),
  maxTokens: z.number().int().positive().optional().default(4096),
});

const AgentFrontmatterSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string()).min(1),
  maxSteps: z.number().int().positive(),
  capabilities: CapabilityMatrixSchema.optional(),
  modelIdMapping: z.string().optional(),
});

export function loadAgentConfig(filePath: string): AgentConfig {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: frontmatter, content } = matter(raw);

  const parsed = AgentFrontmatterSchema.parse(frontmatter);

  return {
    name: parsed.name,
    model: parsed.model,
    tools: parsed.tools,
    maxSteps: parsed.maxSteps,
    instructions: content.trim(),
    capabilities: parsed.capabilities as CapabilityMatrix | undefined,
    modelIdMapping: parsed.modelIdMapping,
  };
}

export async function loadAllAgentConfigs(dir: string): Promise<AgentConfig[]> {
  const pattern = path.join(dir, "*.md").replace(/\\/g, "/");
  const files = await fg(pattern);

  return files.map((file) => loadAgentConfig(file));
}
