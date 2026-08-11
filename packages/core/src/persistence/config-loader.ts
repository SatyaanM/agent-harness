import path from "node:path";
import fg from "fast-glob";
import matter from "gray-matter";
import { z } from "zod";
import { type AgentConfig, AgentConfigSchema } from "../agent/types.js";
import { readUtf8FileBoundedSync } from "../filesystem/bounded-io.js";
import { parseBoundary } from "../validation.js";

const MAX_AGENT_CONFIG_BYTES = 2_000_000;

const CapabilityMatrixSchema = z.object({
  chat: z.boolean().optional().default(true),
  tools: z.boolean().optional().default(true),
  vision: z.boolean().optional().default(false),
  streaming: z.boolean().optional().default(true),
  maxTokens: z.number().int().positive().optional().default(4096),
});

const AgentFrontmatterSchema = AgentConfigSchema.omit({ instructions: true }).extend({
  tools: z.array(z.string().min(1)).min(1).max(128),
  capabilities: CapabilityMatrixSchema.optional(),
});

export function loadAgentConfig(filePath: string): AgentConfig {
  const raw = readUtf8FileBoundedSync(filePath, MAX_AGENT_CONFIG_BYTES, "agent config file");
  const { data: frontmatter, content } = matter(raw);

  const parsed = parseBoundary(
    AgentFrontmatterSchema,
    frontmatter,
    `agent frontmatter ${filePath}`,
  );

  return parseBoundary(
    AgentConfigSchema,
    {
      name: parsed.name,
      model: parsed.model,
      tools: parsed.tools,
      maxSteps: parsed.maxSteps,
      instructions: content.trim(),
      description: parsed.description,
      capabilities: parsed.capabilities,
      modelIdMapping: parsed.modelIdMapping,
      maxToolCalls: parsed.maxToolCalls,
      maxToolResultChars: parsed.maxToolResultChars,
      maxOutputTokens: parsed.maxOutputTokens,
      maxTotalTokens: parsed.maxTotalTokens,
      runTimeoutMs: parsed.runTimeoutMs,
    },
    `agent configuration ${filePath}`,
  );
}

export async function loadAllAgentConfigs(dir: string): Promise<AgentConfig[]> {
  const pattern = path.join(dir, "*.md").replace(/\\/g, "/");
  const files = await fg(pattern);

  return files.map((file) => loadAgentConfig(file));
}
