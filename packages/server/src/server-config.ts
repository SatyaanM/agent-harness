import path from "node:path";
import { parseBoundary } from "@agent-harness/core/contracts";
import { z } from "zod";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const BooleanEnvironmentSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const ServerEnvironmentSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    HOST: z.string().min(1).max(253).default("127.0.0.1"),
    CORS_ORIGINS: z.string().max(4_096).optional(),
    ENABLE_RUN_COMMAND: BooleanEnvironmentSchema,
    ENABLE_WEB_FETCH: BooleanEnvironmentSchema,
    PLUGINS_DIR: z
      .string()
      .min(1)
      .max(32_767)
      .refine((value) => path.isAbsolute(value), "must be an absolute path")
      .optional(),
  })
  .passthrough();

const OriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  }, "Expected an origin without credentials, path, query, or fragment")
  .transform((value) => new URL(value).origin);
const OriginListSchema = z.array(OriginSchema).min(1).max(32);

export interface ServerConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  enableRunCommand: boolean;
  enableWebFetch: boolean;
  pluginsDir?: string;
}

export function parseServerConfig(source: unknown = process.env): ServerConfig {
  const environment = parseBoundary(ServerEnvironmentSchema, source, "server environment");
  const originValues = environment.CORS_ORIGINS
    ? environment.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  return {
    port: environment.PORT,
    host: environment.HOST,
    allowedOrigins: parseBoundary(OriginListSchema, originValues, "server CORS origins"),
    enableRunCommand: environment.ENABLE_RUN_COMMAND,
    enableWebFetch: environment.ENABLE_WEB_FETCH,
    ...(environment.PLUGINS_DIR ? { pluginsDir: environment.PLUGINS_DIR } : {}),
  };
}
