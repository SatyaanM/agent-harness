// Explicit named re-exports (not `export *`): Node's cjs-module-lexer cannot
// statically detect names re-exported through star barrels, so consumers that
// destructure named imports from this entry point fail at load time with
// "does not provide an export named ..." when loaded through CJS interop
// (e.g. Playwright's transpiled test runner).

export type {
  AgentConfig,
  AgentResult,
  CapabilityMatrix,
  Message,
  TaskId,
  ToolCall,
} from "./agent.js";
export {
  AgentConfigSchema,
  AgentResultSchema,
  AssistantMessageSchema,
  CapabilityMatrixSchema,
  MessageSchema,
  SystemMessageSchema,
  TaskIdSchema,
  ToolCallSchema,
  ToolMessageSchema,
  UserMessageSchema,
} from "./agent.js";
export type { ErrorDescriptor } from "./errors.js";
export { describeError } from "./errors.js";
export { parseJsonResponseBoundary, readResponseTextBounded } from "./http.js";
export {
  MAX_INBOX_FILE_BYTES,
  MAX_INBOX_FILE_REQUEST_BYTES,
  MAX_INBOX_FILE_RESPONSE_BYTES,
  MAX_SESSION_MAILBOX_BYTES,
  MAX_SESSION_METADATA_RESPONSE_BYTES,
  MAX_SESSION_RESPONSE_BYTES,
  MAX_SESSION_TRANSCRIPT_BYTES,
} from "./limits.js";
export type { Logger, LoggerOptions, LogLevel, LogRecord, LogSink } from "./logging.js";
export { consoleSink, createLogger } from "./logging.js";
export type {
  InboxRendererManifest,
  PluginCommandManifest,
  PluginManifest,
} from "./plugin.js";
export {
  InboxRendererManifestSchema,
  PluginCommandManifestSchema,
  PluginIdentifierSchema,
  PluginManifestSchema,
} from "./plugin.js";
export type {
  CompactionRange,
  PendingMessage,
  SessionData,
  SessionId,
  WorkerStatus,
  WorkerSummary,
} from "./session.js";
export {
  CompactionRangeSchema,
  createSessionData,
  MAX_WORKERS_PER_SESSION,
  PendingMessageSchema,
  SessionDataSchema,
  SessionIdSchema,
  WorkerStatusSchema,
  WorkerSummaryListSchema,
  WorkerSummarySchema,
} from "./session.js";
export type { ChatStreamEvent } from "./streaming.js";
export { ChatStreamEventSchema } from "./streaming.js";
export type {
  AttributeValue,
  ISpan,
  ITraceContext,
  ITracer,
  SpanAttributes,
  SpanEvent,
  SpanKind,
  SpanLink,
  SpanOptions,
  SpanStatus,
  SpanStatusCode,
} from "./tracing.js";
export {
  getTracer,
  NoopSpan,
  NoopTracer,
  resetGlobalTracer,
  setGlobalTracer,
  W3CTraceContext,
  W3CTraceParentSchema,
} from "./tracing.js";
export {
  BoundaryValidationError,
  isRecord,
  parseBoundary,
  parseJsonBoundary,
} from "./validation.js";
