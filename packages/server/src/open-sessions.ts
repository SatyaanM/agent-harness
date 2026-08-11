import fs from "node:fs";
import path from "node:path";
import { getConfig, parseBoundary, parseJsonBoundary } from "@agent-harness/core";
import { z } from "zod";
import { IdentifierSchema } from "./http/validation.js";

/**
 * Open-sessions registry (ADR §12.1).
 *
 * The set of open sessions (and which is active) is durable, server-owned
 * state. The dashboard submits its whole snapshot via PUT; the server persists
 * it and serves it back on boot so the tab bar survives restarts.
 */

export const OpenSessionsStateSchema = z
  .object({
    activeSessionId: IdentifierSchema.nullable(),
    openSessionIds: z.array(IdentifierSchema).max(100),
  })
  .strict();
export type OpenSessionsState = z.infer<typeof OpenSessionsStateSchema>;

const EMPTY: OpenSessionsState = { activeSessionId: null, openSessionIds: [] };

function stateFile(): string {
  return path.join(getConfig().ROOT, ".harness", "open-sessions.json");
}

export function loadOpenSessions(): OpenSessionsState {
  try {
    return parseJsonBoundary(
      OpenSessionsStateSchema,
      fs.readFileSync(stateFile(), "utf-8"),
      "open sessions state",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ...EMPTY };
    }
    throw error;
  }
}

/** Atomic write (temp + rename) so a crash can never leave a truncated file. */
export function saveOpenSessions(state: OpenSessionsState): void {
  const parsed = parseBoundary(OpenSessionsStateSchema, state, "open sessions save");
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}
