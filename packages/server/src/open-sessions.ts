import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@agent-harness/core";

/**
 * Open-sessions registry (ADR §12.1).
 *
 * The set of open sessions (and which is active) is durable, server-owned
 * state. The dashboard submits its whole snapshot via PUT; the server persists
 * it and serves it back on boot so the tab bar survives restarts.
 */

export interface OpenSessionsState {
  activeSessionId: string | null;
  openSessionIds: string[];
}

const EMPTY: OpenSessionsState = { activeSessionId: null, openSessionIds: [] };

function stateFile(): string {
  return path.join(getConfig().ROOT, ".harness", "open-sessions.json");
}

export function loadOpenSessions(): OpenSessionsState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as Partial<OpenSessionsState>;
    return {
      activeSessionId: typeof raw.activeSessionId === "string" ? raw.activeSessionId : null,
      openSessionIds: Array.isArray(raw.openSessionIds)
        ? raw.openSessionIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Atomic write (temp + rename) so a crash can never leave a truncated file. */
export function saveOpenSessions(state: OpenSessionsState): void {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}
