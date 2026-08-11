import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SeveritySchema = z.enum(["info", "low", "moderate", "high", "critical"]);
const AuditReportSchema = z
  .object({
    vulnerabilities: z.record(
      z
        .object({
          severity: SeveritySchema,
        })
        .passthrough(),
    ),
  })
  .passthrough();
const ExceptionFileSchema = z
  .object({
    version: z.literal(1),
    exceptions: z.array(
      z
        .object({
          package: z.string().min(1),
          reason: z.string().min(1),
          expires: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();

export function evaluateSecurityAudit(rawAudit, rawExceptions, now = new Date()) {
  const audit = AuditReportSchema.parse(rawAudit);
  const exceptionFile = ExceptionFileSchema.parse(rawExceptions);
  const expired = exceptionFile.exceptions.filter(
    (exception) => Date.parse(exception.expires) <= now.getTime(),
  );
  const activePackages = new Set(
    exceptionFile.exceptions
      .filter((exception) => Date.parse(exception.expires) > now.getTime())
      .map((exception) => exception.package),
  );
  const unaccepted = Object.entries(audit.vulnerabilities)
    .filter(
      ([packageName, vulnerability]) =>
        (vulnerability.severity === "high" || vulnerability.severity === "critical") &&
        !activePackages.has(packageName),
    )
    .map(([packageName, vulnerability]) => ({
      package: packageName,
      severity: vulnerability.severity,
    }));
  return { expired, unaccepted };
}

function runAudit() {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  const args = ["npm", "audit", "--omit=dev", "--json"];
  if (process.platform !== "win32") {
    return spawnSync(corepack, args, { cwd: process.cwd(), encoding: "utf8" });
  }
  return spawnSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", [corepack, ...args].join(" ")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  const auditResult = runAudit();
  if (auditResult.error) throw auditResult.error;

  let rawAudit;
  try {
    rawAudit = JSON.parse(auditResult.stdout);
  } catch (error) {
    console.error(auditResult.stderr || "npm audit did not return valid JSON", error);
    process.exit(1);
  }
  const exceptionPath = path.join(process.cwd(), "security-audit-exceptions.json");
  let result;
  try {
    const rawExceptions = JSON.parse(readFileSync(exceptionPath, "utf8"));
    result = evaluateSecurityAudit(rawAudit, rawExceptions);
  } catch {
    console.error(
      auditResult.stderr ||
        "Security audit output or security-audit-exceptions.json failed schema validation.",
    );
    process.exit(1);
  }
  for (const exception of result.expired) {
    console.error(`Expired security exception: ${exception.package} (${exception.expires})`);
  }
  for (const vulnerability of result.unaccepted) {
    console.error(
      `Unaccepted ${vulnerability.severity} production vulnerability: ${vulnerability.package}`,
    );
  }
  if (result.expired.length > 0 || result.unaccepted.length > 0) {
    process.exitCode = 1;
  } else {
    console.log("Production dependency audit passed with no unaccepted high/critical findings.");
  }
}
