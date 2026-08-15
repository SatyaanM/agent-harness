import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BoundaryValidationError,
  getConfig,
  parseBoundary,
  parseJsonBoundary,
  readUtf8FileBoundedSync,
  stringifyJsonBounded,
} from "@agent-harness/core";
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
const MAX_OPEN_SESSIONS_STATE_BYTES = 1_000_000;

function stateFile(): string {
  return path.join(getConfig().ROOT, ".harness", "open-sessions.json");
}

export function loadOpenSessions(): OpenSessionsState {
  try {
    return parseJsonBoundary(
      OpenSessionsStateSchema,
      readUtf8FileBoundedSync(stateFile(), MAX_OPEN_SESSIONS_STATE_BYTES, "open sessions state"),
      "open sessions state",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ...EMPTY };
    }
    throw error;
  }
}

export function loadOpenSessionsForRepair(): OpenSessionsState {
  try {
    return loadOpenSessions();
  } catch (error) {
    if (!(error instanceof BoundaryValidationError)) throw error;
    const file = stateFile();
    const quarantine = `${file}.invalid-${Date.now()}-${randomUUID()}`;
    fs.renameSync(file, quarantine);
    return { ...EMPTY };
  }
}

/** Atomic write (temp + rename) so a crash can never leave a truncated file. */
export function saveOpenSessions(state: OpenSessionsState): void {
  const parsed = parseBoundary(OpenSessionsStateSchema, state, "open sessions save");
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(
      tmp,
      stringifyJsonBounded(parsed, MAX_OPEN_SESSIONS_STATE_BYTES, "open sessions state"),
      "utf-8",
    );
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw error;
  }
}
