import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type AgentConfig,
  AgentConfigSchema,
  BoundaryValidationError,
  getConfig,
  isRecord,
  loadAllAgentConfigs,
  parseAgentConfigSource,
} from "@agent-harness/core";
import { type Response, Router } from "express";
import matter from "gray-matter";
import { z } from "zod";
import {
  AuthorizedPathChangedError,
  openAuthorizedExistingFile,
  readAuthorizedFileBounded,
  validateAuthorizedFileHandle,
} from "../filesystem/authorized-file.js";
import { asyncHandler } from "../http/async-handler.js";
import { createRouteLimiters, type RouteLimiters } from "../http/rate-limit.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";

const AgentParamsSchema = z.object({ name: IdentifierSchema }).strict();
const AgentCreateSchema = AgentConfigSchema.partial()
  .extend({ name: IdentifierSchema, model: z.string().min(1).max(256) })
  .strict();
const AgentUpdateSchema = AgentConfigSchema.omit({ name: true }).partial().strict();
const AgentSourceSchema = z.object({ source: z.string().max(2_000_000) }).strict();

async function readAgentSource(
  filePath: string,
  root: string,
  res: Response,
): Promise<string | undefined> {
  try {
    const opened = await openAuthorizedExistingFile(filePath, root, "r");
    try {
      if (!opened.stat.isFile()) {
        res.status(404).json({ error: "Agent not found" });
        return undefined;
      }
      return (await readAuthorizedFileBounded(opened.handle, 2_000_000, "agent source")).toString(
        "utf8",
      );
    } finally {
      await opened.handle.close();
    }
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      res.status(404).json({ error: "Agent not found" });
      return undefined;
    }
    if (error instanceof AuthorizedPathChangedError) {
      res.status(403).json({ error: "Invalid agent path" });
      return undefined;
    }
    throw error;
  }
}

export function createAgentsRouter(limiters: RouteLimiters = createRouteLimiters()): Router {
  const router = Router();

  router.get(
    "/",
    limiters.configurationRead,
    asyncHandler(async (_req, res) => {
      const config = getConfig();
      const agents = await loadAllAgentConfigs(config.AGENTS_DIR);
      res.json(agents);
    }),
  );

  router.get(
    "/:name/source",
    limiters.configurationRead,
    asyncHandler(async (req, res) => {
      const params = validateRequest(AgentParamsSchema, req.params, res);
      if (!params) return;
      const agentsRoot = getConfig().AGENTS_DIR;
      const filePath = path.join(agentsRoot, `${params.name}.md`);
      const source = await readAgentSource(filePath, agentsRoot, res);
      if (source === undefined) return;
      res.json({ source });
    }),
  );

  router.put(
    "/:name/source",
    limiters.configurationWrite,
    asyncHandler(async (req, res) => {
      const params = validateRequest(AgentParamsSchema, req.params, res);
      if (!params) return;
      const body = validateRequest(AgentSourceSchema, req.body, res);
      if (!body) return;
      const agentsRoot = getConfig().AGENTS_DIR;
      const filePath = path.join(agentsRoot, `${params.name}.md`);
      try {
        const parsed = parseAgentConfigSource(body.source, filePath);
        if (parsed.name !== params.name) {
          res.status(400).json({
            error: {
              code: "invalid_request",
              message: "Agent source name must match the route identifier",
            },
          });
          return;
        }
        await replaceExistingAgentFile(filePath, agentsRoot, body.source);
        sessionManager.audit({
          actorType: "user",
          actorId: "user",
          action: "agent.update_source",
          resourceType: "agent",
          resourceId: params.name,
          payload: { sourceLength: body.source.length },
        });
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
        if (isRecord(error) && error.code === "ENOENT") {
          res.status(404).json({ error: "Agent not found" });
          return;
        }
        if (error instanceof AuthorizedPathChangedError) {
          res.status(403).json({ error: "Invalid agent path" });
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:name",
    limiters.configurationRead,
    asyncHandler(async (req, res) => {
      const params = validateRequest(AgentParamsSchema, req.params, res);
      if (!params) return;
      const config = getConfig();
      const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
      const source = await readAgentSource(filePath, config.AGENTS_DIR, res);
      if (source === undefined) return;
      const agentConfig = parseAgentConfigSource(source, filePath);
      res.json(agentConfig);
    }),
  );

  router.post(
    "/",
    limiters.configurationWrite,
    asyncHandler(async (req, res) => {
      const config = getConfig();
      const body = validateRequest(AgentCreateSchema, req.body, res);
      if (!body) return;

      const filePath = path.join(config.AGENTS_DIR, `${body.name}.md`);
      await fs.mkdir(config.AGENTS_DIR, { recursive: true });

      try {
        const agentConfig = await writeAgentConfig(
          filePath,
          {
            name: body.name,
            model: body.model,
            ...(body.provider !== undefined ? { provider: body.provider } : {}),
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
            ...(body.maxOutputTokens !== undefined
              ? { maxOutputTokens: body.maxOutputTokens }
              : {}),
            ...(body.maxTotalTokens !== undefined ? { maxTotalTokens: body.maxTotalTokens } : {}),
            ...(body.runTimeoutMs !== undefined ? { runTimeoutMs: body.runTimeoutMs } : {}),
          },
          true,
        );
        sessionManager.audit({
          actorType: "user",
          actorId: "user",
          action: "agent.create",
          resourceType: "agent",
          resourceId: body.name,
          payload: { model: body.model, tools: body.tools ?? [] },
        });
        res.status(201).json(agentConfig);
      } catch (error) {
        if (
          isRecord(error) &&
          (error.code === "EEXIST" ||
            (typeof error.message === "string" && error.message.includes("EEXIST")))
        ) {
          res.status(409).json({ error: "Agent already exists" });
          return;
        }
        throw error;
      }
    }),
  );

  router.put(
    "/:name",
    limiters.configurationWrite,
    asyncHandler(async (req, res) => {
      const params = validateRequest(AgentParamsSchema, req.params, res);
      if (!params) return;
      const body = validateRequest(AgentUpdateSchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const filePath = path.join(config.AGENTS_DIR, `${params.name}.md`);
      const source = await readAgentSource(filePath, config.AGENTS_DIR, res);
      if (source === undefined) return;
      const existing = parseAgentConfigSource(source, filePath);
      const agentConfig = await writeAgentConfig(
        filePath,
        {
          ...existing,
          ...body,
          name: params.name,
        },
        false,
        config.AGENTS_DIR,
      );
      sessionManager.audit({
        actorType: "user",
        actorId: "user",
        action: "agent.update",
        resourceType: "agent",
        resourceId: params.name,
        payload: body,
      });
      res.json(agentConfig);
    }),
  );

  router.delete(
    "/:name",
    limiters.configurationWrite,
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
      sessionManager.audit({
        actorType: "user",
        actorId: "user",
        action: "agent.delete",
        resourceType: "agent",
        resourceId: params.name,
        payload: {},
      });
      res.status(204).end();
    }),
  );

  return router;
}

function buildAgentMarkdown(config: Partial<z.infer<typeof AgentConfigSchema>>): string {
  const frontmatter: Record<string, unknown> = {
    name: config.name ?? "unnamed",
    model: config.model ?? "qwen3.7-plus",
    tools: config.tools ?? [],
    maxSteps: config.maxSteps ?? 10,
  };

  if (config.provider !== undefined) {
    frontmatter.provider = config.provider;
  }

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

async function writeAgentConfig(
  filePath: string,
  config: AgentConfig,
  exclusive = false,
  root?: string,
): Promise<AgentConfig> {
  const content = buildAgentMarkdown(config);
  if (exclusive) {
    const parsed = parseAgentConfigSource(content, filePath);
    const handle = await fs.open(filePath, "wx");
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
      await handle.close();
      return parsed;
    } catch (error) {
      await handle.close().catch(() => null);
      await fs.unlink(filePath).catch(() => null);
      throw error;
    }
  }

  if (!root) throw new Error("Agent root is required when replacing an existing configuration");
  const parsed = parseAgentConfigSource(content, filePath);
  await replaceExistingAgentFile(filePath, root, content);
  return parsed;
}

async function replaceExistingAgentFile(
  filePath: string,
  root: string,
  content: string,
): Promise<void> {
  const opened = await openAuthorizedExistingFile(filePath, root, "r+");
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    if (!opened.stat.isFile()) throw new AuthorizedPathChangedError(filePath);
    temporaryHandle = await fs.open(temporaryFile, "wx");
    await temporaryHandle.writeFile(content, "utf-8");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await validateAuthorizedFileHandle(opened.handle, filePath, root);
    // Windows does not permit replacing a pathname while its prior file handle is open.
    // The immediately preceding identity check narrows, but cannot eliminate, this rename window.
    await opened.handle.close();
    await fs.rename(temporaryFile, filePath);
  } finally {
    await temporaryHandle?.close().catch(() => null);
    await opened.handle.close().catch(() => null);
    await fs.rm(temporaryFile, { force: true }).catch(() => null);
  }
}
