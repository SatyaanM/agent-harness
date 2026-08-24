import http from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";
import { matchScenario, type ScenarioMessage } from "./scenarios.js";

export interface FakeServerOptions {
  port?: number;
  host?: string;
}

export interface FakeServerInstance {
  server: http.Server;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(body);
        if (isRecord(parsed)) {
          resolve(parsed);
        } else {
          resolve({});
        }
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function extractScenarioMessages(body: Record<string, unknown>): ScenarioMessage[] {
  const raw = body.messages;
  if (!Array.isArray(raw)) return [];
  const result: ScenarioMessage[] = [];
  for (const item of raw) {
    if (typeof item === "object" && item !== null && "role" in item) {
      const role = String(item.role);
      const content = "content" in item ? item.content : "";
      result.push({ role, content });
    }
  }
  return result;
}

function handlePreflightOrInfo(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): boolean {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === "/health" || pathname === "/v1/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", provider: "fake-llm-service" }));
    return true;
  }

  if (pathname === "/v1/models" || pathname === "/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.headers["anthropic-version"] !== undefined) {
      res.end(
        JSON.stringify({
          data: [
            {
              type: "model",
              id: "claude-3-5-sonnet-20241022",
              display_name: "Claude 3.5 Sonnet",
              created_at: "2024-10-22T00:00:00Z",
            },
          ],
          has_more: false,
          first_id: "claude-3-5-sonnet-20241022",
          last_id: "claude-3-5-sonnet-20241022",
        }),
      );
      return true;
    }
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: "opencode-go/qwen3.7-plus",
            object: "model",
            created: 1700000000,
            owned_by: "fake",
          },
          { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "fake" },
          {
            id: "claude-3-5-sonnet-20241022",
            object: "model",
            created: 1700000000,
            owned_by: "fake",
          },
        ],
      }),
    );
    return true;
  }

  return false;
}

export function createFakeProviderServer(
  options: FakeServerOptions = {},
): Promise<FakeServerInstance> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0; // 0 chooses an available OS port

  const activeSockets = new Set<Socket>();

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = parsedUrl.pathname;

    if (handlePreflightOrInfo(req, res, pathname)) {
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: `Method ${req.method ?? "UNKNOWN"} not allowed` } }),
      );
      return;
    }

    let body: Record<string, unknown> = {};
    try {
      body = await parseJsonBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Malformed JSON request body" } }));
      return;
    }

    const scenarioHeader = req.headers["x-test-scenario"];
    const scenarioName = Array.isArray(scenarioHeader) ? scenarioHeader[0] : scenarioHeader;
    const messages = extractScenarioMessages(body);
    const scenario = matchScenario(scenarioName, messages);
    const scenarioResult = scenario.handle(messages);

    if (scenarioResult.status && scenarioResult.status >= 400) {
      const status = scenarioResult.status;
      const headers = { "Content-Type": "application/json", ...(scenarioResult.headers ?? {}) };
      res.writeHead(status, headers);
      res.end(
        scenarioResult.content ??
          JSON.stringify({ error: { message: "Simulated error", code: status } }),
      );
      return;
    }

    if (scenarioResult.disconnectMidStream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"id":"mock","choices":[{"delta":{"content":"start"}}]}\n\n');
      req.socket.destroy();
      return;
    }

    const isAnthropic = pathname.includes("/messages");
    const stream = Boolean(body.stream);

    if (isAnthropic) {
      handleAnthropicResponse(res, scenarioResult, stream);
    } else {
      handleOpenAIResponse(res, scenarioResult, stream);
    }
  });

  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unable to retrieve bound address"));
        return;
      }
      const boundPort = addr.port;
      const url = `http://${host}:${boundPort}`;
      resolve({
        server,
        port: boundPort,
        host,
        url,
        close: async () => {
          for (const socket of activeSockets) {
            socket.destroy();
          }
          activeSockets.clear();
          await new Promise<void>((resClose, rejClose) => {
            server.close((err) => {
              if (err) rejClose(err);
              else resClose();
            });
          });
        },
      });
    });
    server.on("error", reject);
  });
}

function handleOpenAIResponse(
  res: http.ServerResponse,
  scenarioResult: ReturnType<typeof matchScenario>["handle"] extends (...args: unknown[]) => infer R
    ? R
    : never,
  stream: boolean,
): void {
  const content = scenarioResult.content ?? "";
  const toolCalls = scenarioResult.toolCalls;
  const finishReason = toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop";

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunkId = `chatcmpl-${Date.now()}`;
    res.write(
      `data: ${JSON.stringify({
        id: chunkId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "fake-gpt-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      })}\n\n`,
    );

    if (content) {
      res.write(
        `data: ${JSON.stringify({
          id: chunkId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "fake-gpt-model",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`,
      );
    }

    if (toolCalls && toolCalls.length > 0) {
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        if (tc) {
          res.write(
            `data: ${JSON.stringify({
              id: chunkId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "fake-gpt-model",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: i,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.name,
                          arguments: JSON.stringify(tc.arguments),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
        }
      }
    }

    res.write(
      `data: ${JSON.stringify({
        id: chunkId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "fake-gpt-model",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      })}\n\n`,
    );

    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    const formattedToolCalls = toolCalls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));

    const responsePayload = {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "fake-gpt-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            ...(formattedToolCalls && formattedToolCalls.length > 0
              ? { tool_calls: formattedToolCalls }
              : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responsePayload));
  }
}

function handleAnthropicResponse(
  res: http.ServerResponse,
  scenarioResult: ReturnType<typeof matchScenario>["handle"] extends (...args: unknown[]) => infer R
    ? R
    : never,
  stream: boolean,
): void {
  const content = scenarioResult.content ?? "";
  const toolCalls = scenarioResult.toolCalls;
  const stopReason = toolCalls && toolCalls.length > 0 ? "tool_use" : "end_turn";

  const anthropicContent: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }> = [];

  if (content) {
    anthropicContent.push({ type: "text", text: content });
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      anthropicContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      });
    }
  }

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const msgId = `msg_${Date.now()}`;
    res.write(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model: "fake-claude-model", usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`,
    );

    let blockIndex = 0;
    if (content) {
      res.write(
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } })}\n\n`,
      );
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: content } })}\n\n`,
      );
      res.write(
        `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIndex })}\n\n`,
      );
      blockIndex++;
    }

    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        res.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: {},
            },
          })}\n\n`,
        );
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: blockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(tc.arguments),
            },
          })}\n\n`,
        );
        res.write(
          `event: content_block_stop\ndata: ${JSON.stringify({
            type: "content_block_stop",
            index: blockIndex,
          })}\n\n`,
        );
        blockIndex++;
      }
    }

    res.write(
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } })}\n\n`,
    );
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  } else {
    const payload = {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      content: anthropicContent,
      model: "fake-claude-model",
      stop_reason: stopReason,
      usage: {
        input_tokens: 15,
        output_tokens: 25,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }
}
