import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SeveritySchema = z.enum(["info", "low", "moderate", "high", "critical"]);
const AuditAdvisorySchema = z
  .object({
    source: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    module_name: z.string().optional(),
    severity: SeveritySchema.optional(),
    url: z.string().optional(),
  })
  .passthrough();
const AuditReportSchema = z
  .object({
    vulnerabilities: z
      .record(
        z
          .object({
            severity: SeveritySchema,
            via: z.array(z.union([z.string(), AuditAdvisorySchema])).optional(),
          })
          .passthrough(),
      )
      .optional()
      .default({}),
    advisories: z.record(AuditAdvisorySchema).optional().default({}),
  })
  .passthrough();
const ExceptionFileSchema = z
  .object({
    version: z.literal(2),
    exceptions: z.array(
      z
        .object({
          package: z.string().min(1),
          advisory: z.string().min(1),
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
  const activeExceptions = new Set(
    exceptionFile.exceptions
      .filter((exception) => Date.parse(exception.expires) > now.getTime())
      .map((exception) => `${exception.package}\u0000${exception.advisory}`),
  );

  const vulnerabilities = { ...audit.vulnerabilities };
  if (audit.advisories && Object.keys(audit.advisories).length > 0) {
    for (const [id, adv] of Object.entries(audit.advisories)) {
      const pkg = adv.module_name || id;
      if (!vulnerabilities[pkg]) {
        vulnerabilities[pkg] = {
          severity: adv.severity || "high",
          via: [{ source: adv.id ?? id, url: adv.url, severity: adv.severity }],
        };
      }
    }
  }

  const unaccepted = Object.entries(vulnerabilities)
    .filter(([packageName, vulnerability]) => {
      if (vulnerability.severity !== "high" && vulnerability.severity !== "critical") {
        return false;
      }
      const groups = advisoryIdentifierGroups(vulnerability.via ?? []);
      return (
        groups.length === 0 ||
        groups.some(
          (identifiers) =>
            !identifiers.some((identifier) =>
              activeExceptions.has(`${packageName}\u0000${identifier}`),
            ),
        )
      );
    })
    .map(([packageName, vulnerability]) => ({
      package: packageName,
      severity: vulnerability.severity,
    }));
  return { expired, unaccepted };
}

function advisoryIdentifierGroups(via) {
  return via.flatMap((entry) => {
    if (typeof entry === "string") return [[entry]];
    if (entry.severity && entry.severity !== "high" && entry.severity !== "critical") return [];
    return [[String(entry.source ?? entry.id ?? ""), ...(entry.url ? [entry.url] : [])]];
  });
}

function runAudit() {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  const args = ["pnpm", "audit", "--prod", "--json"];
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
