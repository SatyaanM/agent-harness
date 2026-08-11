import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getConfig } from "../config.js";
import { isRecord } from "../validation.js";
import type { Tool } from "./types.js";
import { assertWithinRoot } from "./utils.js";

const execFileAsync = promisify(execFile);

const RunCommandParams = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});

const TIMEOUT_MS = 30_000;

export const runCommandTool: Tool<typeof RunCommandParams> = {
  name: "runCommand",
  description: "Execute a shell command. Returns stdout and stderr. Timeout: 30 seconds.",
  parameters: RunCommandParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const cwd = args.cwd ? path.resolve(root, args.cwd) : root;
    assertWithinRoot(cwd, root);

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
