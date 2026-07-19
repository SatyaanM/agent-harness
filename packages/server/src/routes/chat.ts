import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  Agent,
  CapabilityRegistry,
  ToolRegistry,
  createVercelAILLMClient,
  getConfig,
  SessionStore,
  loadAgentConfig,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirectoryTool,
  globTool,
  grepTool,
  runCommandTool,
  webFetchTool,
} from "@agent-harness/core";
import type { SessionData } from "@agent-harness/core";
import { emitAgentEvent } from "../ws/events.js";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const config = getConfig();
  console.log("[chat] Config:", {
    PROVIDER_ENDPOINT: config.PROVIDER_ENDPOINT,
    DEFAULT_MODEL: config.DEFAULT_MODEL,
    API_KEY_ENV: config.API_KEY_ENV,
    API_KEY_SET: !!process.env[config.API_KEY_ENV],
    AGENTS_DIR: config.AGENTS_DIR,
  });

  const sessionStore = new SessionStore(config.SESSIONS_DIR);
  const { sessionId, message } = req.body as { sessionId?: string; message?: string };

  console.log("[chat] Request:", { sessionId, messageLength: message?.length });

  if (!sessionId || !message) {
    res.status(400).json({ error: "sessionId and message are required" });
    return;
  }

  let session = await sessionStore.load(sessionId);
  if (!session) {
    session = {
      sessionId,
      taskId: randomUUID(),
      prompt: message,
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const orchestratorConfigPath = `${config.AGENTS_DIR}/orchestrator.md`;
    let agentConfig;
    try {
      agentConfig = loadAgentConfig(orchestratorConfigPath);
      // Replace DEFAULT model placeholder with the actual default from settings
      if (agentConfig.model === "DEFAULT") {
        agentConfig.model = config.DEFAULT_MODEL;
      }
      console.log("[chat] Loaded agent config:", { name: agentConfig.name, model: agentConfig.model });
    } catch (err) {
      console.log("[chat] Failed to load agent config, using defaults:", err);
      agentConfig = {
        name: "orchestrator",
        model: config.DEFAULT_MODEL,
        tools: [],
        maxSteps: 10,
        instructions: "You are a helpful orchestrator agent.",
      };
    }

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(createReadFileTool(config.ROOT));
    toolRegistry.register(createWriteFileTool(config.ROOT));
    toolRegistry.register(createEditFileTool(config.ROOT));
    toolRegistry.register(createListDirectoryTool(config.ROOT));
    toolRegistry.register(globTool);
    toolRegistry.register(grepTool);
    toolRegistry.register(runCommandTool);
    toolRegistry.register(webFetchTool);
    console.log("[chat] Registered tools:", toolRegistry.getAll().map((t) => t.name));
    console.log("[chat] Agent config tools:", agentConfig.tools);
    const llmClient = createVercelAILLMClient(config);
    const capabilityRegistry = new CapabilityRegistry({
      workspaceRoot: config.ROOT,
      baseUrl: config.PROVIDER_ENDPOINT,
    });

    const agent = new Agent(agentConfig, toolRegistry, llmClient, capabilityRegistry);

    emitAgentEvent("agent:started", { sessionId, agentName: agentConfig.name });

    session.messages.push({ role: "user", content: message, createdAt: new Date().toISOString() });

    console.log("[chat] Running agent with model:", agentConfig.model, "history length:", session.messages.length);
    console.log("[chat] History messages:", session.messages.slice(0, -1).map((m) => `${m.role}: ${m.content.slice(0, 50)}...`));
    const result = await agent.run(message, session.messages.slice(0, -1));
    console.log("[chat] Agent completed:", { status: result.status, summaryLength: result.summary?.length });

    const chunks = result.summary.match(/.{1,40}(\s|$)/gs) ?? [result.summary];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ type: "text-delta", text: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);

    session.messages.push({ role: "assistant", content: result.summary, createdAt: new Date().toISOString() });
    session.result = { status: result.status, summary: result.summary };
    session.completedAt = new Date().toISOString();
    await sessionStore.save(session);

    emitAgentEvent("agent:completed", { sessionId, agentName: agentConfig.name, status: result.status });
  } catch (error) {
    console.error("[chat] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
    emitAgentEvent("agent:error", { sessionId, error: errorMessage });
  }

  res.end();
});
