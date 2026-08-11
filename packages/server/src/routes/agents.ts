import fs from "node:fs";
import path from "node:path";
import {
  AgentConfigSchema,
  getConfig,
  loadAgentConfig,
  loadAllAgentConfigs,
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

agentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const config = getConfig();
    const agents = await loadAllAgentConfigs(config.AGENTS_DIR);
    res.json(agents);
  }),
);

agentsRouter.get(
  "/:name",
  asyncHandler(async (req, res) => {
    const params = validateRequest(AgentParamsSchema, req.params, res);
    if (!params) return;
    const config = getConfig();
    const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
    if (!fs.existsSync(filePath)) {
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
    if (fs.existsSync(filePath)) {
      res.status(409).json({ error: "Agent already exists" });
      return;
    }

    const content = buildAgentMarkdown(body);
    fs.mkdirSync(config.AGENTS_DIR, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");

    const agentConfig = loadAgentConfig(filePath);
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
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const content = buildAgentMarkdown({ ...body, name: params.name });
    fs.writeFileSync(filePath, content, "utf-8");

    const agentConfig = loadAgentConfig(filePath);
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
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    fs.unlinkSync(filePath);
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
