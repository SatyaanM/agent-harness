import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getConfig } from "../config.js";
import { isRecord } from "../validation.js";
import type { Tool } from "./types.js";
import { assertExistingPathWithinRoot, assertWithinRoot, WorkspacePathSchema } from "./utils.js";

const execFileAsync = promisify(execFile);

const RunCommandParams = z
  .object({
    command: z
      .string()
      .min(1)
      .max(100_000)
      .refine((value) => !value.includes("\0"), "must not contain a null byte"),
    cwd: WorkspacePathSchema.optional(),
  })
  .strict();

const TIMEOUT_MS = 30_000;
const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

export function buildSubprocessEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) =>
        value !== undefined &&
        (ALLOWED_ENVIRONMENT_KEYS.has(key.toUpperCase()) || key.toUpperCase().startsWith("LC_")),
    ),
  );
}

export const runCommandTool: Tool<typeof RunCommandParams> = {
  name: "runCommand",
  description: "Execute a shell command. Returns stdout and stderr. Timeout: 30 seconds.",
  parameters: RunCommandParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const cwd = args.cwd ? path.resolve(root, args.cwd) : root;
    assertWithinRoot(cwd, root);
    await assertExistingPathWithinRoot(cwd, root);

    try {
      const { stdout, stderr } = await execFileAsync(
        process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        process.platform === "win32" ? ["/c", args.command] : ["-c", args.command],
        {
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          shell: false,
          env: buildSubprocessEnvironment(process.env),
        },
      );

      const parts: string[] = [];
      if (stdout.trim()) parts.push(stdout.trimEnd());
      if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`);
      return parts.length > 0 ? parts.join("\n\n") : "(no output)";
    } catch (err: unknown) {
      const details = isRecord(err) ? err : {};
      const stdout = typeof details.stdout === "string" ? details.stdout : undefined;
      const stderr = typeof details.stderr === "string" ? details.stderr : undefined;
      const message = err instanceof Error ? err.message : String(err);
      if (details.killed === true) {
        return `[error] Command timed out after ${TIMEOUT_MS}ms.`;
      }
      const parts: string[] = [];
      if (stdout?.trim()) parts.push(stdout.trimEnd());
      if (stderr?.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`);
      if (parts.length === 0) parts.push(`[error] ${message}`);
      return parts.join("\n\n");
    }
  },
};
