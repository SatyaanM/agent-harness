import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type AgentConfig,
  AgentConfigSchema,
  BoundaryValidationError,
  getConfig,
  loadAgentConfig,
  loadAllAgentConfigs,
  readUtf8FileBounded,
} from "@agent-harness/core";
import { Router } from "express";
import matter from "gray-matter";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";

export const agentsRouter = Router();

const AgentParamsSchema = z.object({ name: IdentifierSchema }).strict();
const AgentCreateSchema = AgentConfigSchema.partial()
  .extend({ name: IdentifierSchema, model: z.string().min(1).max(256) })
  .strict();
const AgentUpdateSchema = AgentConfigSchema.omit({ name: true }).partial().strict();
const AgentSourceSchema = z.object({ source: z.string().max(2_000_000) }).strict();

agentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const config = getConfig();
    const agents = await loadAllAgentConfigs(config.AGENTS_DIR);
    res.json(agents);
  }),
);

agentsRouter.get(
  "/:name/source",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const filePath = path.join(getConfig().AGENTS_DIR, `${params.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const source = await readUtf8FileBounded(filePath, 2_000_000, "agent source");
    res.json({ source });
  }),
);

agentsRouter.put(
  "/:name/source",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const body = validateRequest(AgentSourceSchema, req.body, res);
    if (!body) return;
    const filePath = path.join(getConfig().AGENTS_DIR, `${params.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryFile, body.source, "utf-8");
      const parsed = loadAgentConfig(temporaryFile);
      if (parsed.name !== params.name) {
        res.status(400).json({
          error: {
            code: "invalid_request",
            message: "Agent source name must match the route identifier",
          },
        });
        return;
      }
      await fs.rename(temporaryFile, filePath);
      res.json(parsed);
    } catch (error) {
      if (
        error instanceof BoundaryValidationError ||
        (error instanceof Error && error.name === "YAMLException")
      ) {
        res.status(400).json({
          error: { code: "invalid_request", message: "Agent source is invalid" },
        });
        return;
      }
      throw error;
    } finally {
      await fs.rm(temporaryFile, { force: true }).catch(() => null);
    }
  }),
);

agentsRouter.get(
  "/:name",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const config = getConfig();
    const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const agentConfig = loadAgentConfig(filePath);
    res.json(agentConfig);
  }),
);

agentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const config = getConfig();
    const body = validateRequest(AgentCreateSchema, req.body, res);
    if (!body) return;

    const filePath = path.join(config.AGENTS_DIR, `${body.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat) {
      res.status(409).json({ error: "Agent already exists" });
      return;
    }

    await fs.mkdir(config.AGENTS_DIR, { recursive: true });
    const agentConfig = await writeAgentConfig(filePath, {
      name: body.name,
      model: body.model,
      tools: body.tools ?? [],
      maxSteps: body.maxSteps ?? 10,
      instructions: body.instructions ?? "",
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
      ...(body.modelIdMapping !== undefined ? { modelIdMapping: body.modelIdMapping } : {}),
      ...(body.maxToolCalls !== undefined ? { maxToolCalls: body.maxToolCalls } : {}),
      ...(body.maxToolResultChars !== undefined
        ? { maxToolResultChars: body.maxToolResultChars }
        : {}),
      ...(body.maxOutputTokens !== undefined ? { maxOutputTokens: body.maxOutputTokens } : {}),
      ...(body.maxTotalTokens !== undefined ? { maxTotalTokens: body.maxTotalTokens } : {}),
      ...(body.runTimeoutMs !== undefined ? { runTimeoutMs: body.runTimeoutMs } : {}),
    });
    res.status(201).json(agentConfig);
  }),
);

agentsRouter.put(
  "/:name",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const body = validateRequest(AgentUpdateSchema, req.body, res);
    if (!body) return;
    const config = getConfig();
    const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const existing = loadAgentConfig(filePath);
    const agentConfig = await writeAgentConfig(filePath, {
      ...existing,
      ...body,
      name: params.name,
    });
    res.json(agentConfig);
  }),
);

agentsRouter.delete(
  "/:name",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const config = getConfig();
    const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    await fs.unlink(filePath);
    res.status(204).end();
  }),
);

function buildAgentMarkdown(config: Partial<z.infer<typeof AgentConfigSchema>>): string {
  const frontmatter: Record<string, unknown> = {
    name: config.name ?? "unnamed",
    model: config.model ?? "qwen3.7-plus",
    tools: config.tools ?? [],
    maxSteps: config.maxSteps ?? 10,
  };

  if (config.capabilities) {
    frontmatter.capabilities = config.capabilities;
  }
  if (config.description !== undefined) {
    frontmatter.description = config.description;
  }
  if (config.modelIdMapping) {
    frontmatter.modelIdMapping = config.modelIdMapping;
  }
  for (const key of [
    "maxToolCalls",
    "maxToolResultChars",
    "maxOutputTokens",
    "maxTotalTokens",
    "runTimeoutMs",
  ] as const) {
    if (config[key] !== undefined) frontmatter[key] = config[key];
  }

  const { stringify } = matter;
  return stringify("", frontmatter) + (config.instructions ?? "");
}

async function writeAgentConfig(filePath: string, config: AgentConfig): Promise<AgentConfig> {
  const content = buildAgentMarkdown(config);
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, content, "utf-8");
    const parsed = loadAgentConfig(temporaryFile);
    await fs.rename(temporaryFile, filePath);
    return parsed;
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => null);
    throw error;
  }
}
