import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getConfig, loadAgentConfig, loadAllAgentConfigs } from "@agent-harness/core";
import type { AgentConfig } from "@agent-harness/core";

export const agentsRouter = Router();

agentsRouter.get("/", async (_req, res) => {
  const config = getConfig();
  const agents = await loadAllAgentConfigs(config.AGENTS_DIR);
  res.json(agents);
});

agentsRouter.get("/:name", async (req, res) => {
  const config = getConfig();
  const filePath = path.join(config.AGENTS_DIR, `${req.params["name"]}.md`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const agentConfig = loadAgentConfig(filePath);
  res.json(agentConfig);
});

agentsRouter.post("/", async (req, res) => {
  const config = getConfig();
  const body = req.body as Partial<AgentConfig>;
  if (!body.name || !body.model) {
    res.status(400).json({ error: "name and model are required" });
    return;
  }

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
});

agentsRouter.put("/:name", async (req, res) => {
  const config = getConfig();
  const filePath = path.join(config.AGENTS_DIR, `${req.params["name"]}.md`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = req.body as Partial<AgentConfig>;
  const content = buildAgentMarkdown({ ...body, name: req.params["name"] });
  fs.writeFileSync(filePath, content, "utf-8");

  const agentConfig = loadAgentConfig(filePath);
  res.json(agentConfig);
});

agentsRouter.delete("/:name", async (req, res) => {
  const config = getConfig();
  const filePath = path.join(config.AGENTS_DIR, `${req.params["name"]}.md`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  fs.unlinkSync(filePath);
  res.status(204).end();
});

function buildAgentMarkdown(config: Partial<AgentConfig>): string {
  const frontmatter: Record<string, unknown> = {
    name: config.name ?? "unnamed",
    model: config.model ?? "qwen3.7-plus",
    tools: config.tools ?? [],
    maxSteps: config.maxSteps ?? 10,
  };

  if (config.capabilities) {
    frontmatter["capabilities"] = config.capabilities;
  }
  if (config.modelIdMapping) {
    frontmatter["modelIdMapping"] = config.modelIdMapping;
  }

  const { stringify } = matter;
  return stringify("", frontmatter) + (config.instructions ?? "");
}
