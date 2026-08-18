import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** @typedef {{ file: string, line?: number, rule: string, message: string }} PolicyDiagnostic */

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const STRICT_OPTIONS = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "noUncheckedIndexedAccess",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
];

/**
 * @param {string} rootDir
 * @returns {PolicyDiagnostic[]}
 */
export function checkQualityPolicy(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  return [
    ...checkTypeScriptConfigs(absoluteRoot),
    ...checkWorkflowActionPins(absoluteRoot),
    ...checkKnipConfig(absoluteRoot),
    ...findFiles(absoluteRoot, (file) => SOURCE_EXTENSIONS.has(path.extname(file))).flatMap(
      (file) => checkSourceFile(absoluteRoot, file),
    ),
  ].sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

/** @param {string} rootDir */
function checkKnipConfig(rootDir) {
  const knipPaths = [path.join(rootDir, "knip.json"), path.join(rootDir, "knip.jsonc")];
  /** @type {PolicyDiagnostic[]} */
  const diagnostics = [];

  for (const knipPath of knipPaths) {
    if (!fs.existsSync(knipPath)) continue;
    const relative = relativePath(rootDir, knipPath);
    const content = fs.readFileSync(knipPath, "utf8");
    const parsed = ts.parseConfigFileTextToJson(knipPath, content);
    if (parsed.error) {
      diagnostics.push({
        file: relative,
        rule: "knip/valid-config",
        message: ts.flattenDiagnosticMessageText(parsed.error.messageText, " "),
      });
      continue;
    }
    const config = parsed.config;

    /** @param {any} obj @param {string} location */
    const checkIgnores = (obj, location) => {
      if (!obj || typeof obj !== "object") return;
      const ignoreFields = ["ignore", "ignoreDependencies", "ignoreBinaries"];
      for (const field of ignoreFields) {
        const list = obj[field];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item === "string" && (item.includes("*") || item === "**")) {
              diagnostics.push({
                file: relative,
                rule: "knip/no-wildcard-ignores",
                message: `Wildcard ignore '${item}' in ${location}.${field} is forbidden; use explicit symbol or file exclusions.`,
              });
            }
          }
        }
      }
    };

    checkIgnores(config, "root");
    if (config?.workspaces && typeof config.workspaces === "object") {
      for (const [wsName, wsConfig] of Object.entries(config.workspaces)) {
        checkIgnores(wsConfig, `workspaces['${wsName}']`);
      }
    }
  }

  return diagnostics;
}

/** @param {string} rootDir */
function checkWorkflowActionPins(rootDir) {
  const workflowsDir = path.join(rootDir, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) return [];
  const workflowFiles = findFiles(workflowsDir, (file) => /\.ya?ml$/u.test(file));
  /** @type {PolicyDiagnostic[]} */
  const diagnostics = [];

  for (const workflowFile of workflowFiles) {
    const source = fs.readFileSync(workflowFile, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/u);
      const action = match?.[1];
      if (
        action &&
        !action.startsWith("./") &&
        !action.startsWith("docker://") &&
        !/@[0-9a-f]{40}$/u.test(action)
      ) {
        diagnostics.push({
          file: relativePath(rootDir, workflowFile),
          line: index + 1,
          rule: "supply-chain/pinned-action",
          message: "Third-party GitHub Actions must be pinned to a full commit SHA.",
        });
      }
    }
  }

  return diagnostics;
}

/** @param {string} rootDir */
function checkTypeScriptConfigs(rootDir) {
  const configFiles = findFiles(rootDir, (file) =>
    /^tsconfig(?:\.[^.]+)*\.json$/u.test(path.basename(file)),
  );
  /** @type {PolicyDiagnostic[]} */
  const diagnostics = [];

  for (const configPath of configFiles) {
    const relative = relativePath(rootDir, configPath);
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    if (loaded.error) {
      diagnostics.push({
        file: relative,
        rule: "typescript/config",
        message: ts.flattenDiagnosticMessageText(loaded.error.messageText, " "),
      });
      continue;
    }

    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    if (parsed.options.strict !== true) {
      diagnostics.push({
        file: relative,
        rule: "typescript/strict",
        message: "Every TypeScript project must resolve with compilerOptions.strict=true.",
      });
    }
    for (const option of STRICT_OPTIONS) {
      if (parsed.options[option] === false) {
        diagnostics.push({
          file: relative,
          rule: "typescript/strict-option",
          message: `Strict compiler option ${option} must not be disabled.`,
        });
      }
    }
  }

  return diagnostics;
}

/** @param {string} rootDir @param {string} filePath */
function checkSourceFile(rootDir, filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const relative = relativePath(rootDir, filePath);
  /** @type {PolicyDiagnostic[]} */
  const diagnostics = [];

  const scriptKind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, scriptKind, sourceText);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      /@ts-(?:expect-error|ignore|nocheck)/.test(scanner.getTokenText())
    ) {
      diagnostics.push({
        file: relative,
        line: lineOf(sourceText, scanner.getTokenPos()),
        rule: "typescript/directive",
        message:
          "TypeScript ignore directives are forbidden; validate or narrow the value instead.",
      });
    }
  }
  visit(sourceFile);
  return diagnostics;

  /** @param {ts.Node} node */
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "typescript/no-explicit-any",
        message: "Explicit any is forbidden; use unknown and narrow or validate it.",
      });
    }

    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      (ts.isAsExpression(node.expression) || ts.isTypeAssertionExpression(node.expression))
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "typescript/no-double-assertion",
        message: "Double assertions bypass the type system; validate or narrow the value instead.",
      });
    }

    if (
      ts.isTypeAssertionExpression(node) ||
      (ts.isAsExpression(node) && node.type.getText(sourceFile) !== "const")
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "typescript/no-assertion",
        message: "Type assertions are forbidden; validate or narrow the value instead.",
      });
    }

    if (ts.isNonNullExpression(node)) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "typescript/no-non-null-assertion",
        message: "Non-null assertions are forbidden; narrow or validate the value instead.",
      });
    }

    if (
      relative.startsWith("packages/") &&
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "json" &&
      !(
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "express"
      )
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "boundaries/bounded-json-response",
        message: "HTTP JSON responses must be byte-bounded and schema-validated before use.",
      });
    }

    if (
      relative.startsWith("packages/server/src/routes/") &&
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "req" &&
      ["body", "params", "query"].includes(node.name.text) &&
      !isWithinCallNamed(node, "validateRequest")
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "boundaries/validate-request",
        message: `req.${node.name.text} must flow directly into validateRequest before use.`,
      });
    }

    if (
      relative.startsWith("packages/server/src/routes/") &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["delete", "get", "patch", "post", "put"].includes(node.expression.name.text) &&
      node.arguments.slice(1).some(isAsyncFunction)
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "express/handled-async-route",
        message:
          "Async Express handlers must be wrapped so rejected promises reach error middleware.",
      });
    }

    if (
      (relative.startsWith("packages/core/src/persistence/") ||
        relative.startsWith("packages/server/src/") ||
        relative.startsWith("packages/dashboard/src/")) &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "JSON" &&
      node.expression.name.text === "parse"
    ) {
      diagnostics.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        rule: "boundaries/validated-json",
        message: "Serialized boundary data must use parseJsonBoundary with an explicit schema.",
      });
    }

    if (
      relative.startsWith("packages/core/src/contracts/") &&
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const contractsRoot = path.join(rootDir, "packages", "core", "src", "contracts");
      const resolved = specifier.startsWith(".")
        ? path.resolve(path.dirname(filePath), specifier)
        : undefined;
      if (
        specifier.startsWith("node:") ||
        (resolved !== undefined && !resolved.startsWith(`${contractsRoot}${path.sep}`))
      ) {
        diagnostics.push({
          file: relative,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          rule: "boundaries/browser-safe-contracts",
          message: "Core contracts must not import Node built-ins or core runtime modules.",
        });
      }
    }

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        relative.startsWith("packages/core/src/") &&
        !relative.includes(".test.") &&
        !relative.includes(".spec.")
      ) {
        if (
          specifier === "express" ||
          specifier === "socket.io" ||
          specifier === "react" ||
          specifier === "next" ||
          specifier.startsWith("@agent-harness/server") ||
          specifier.startsWith("@agent-harness/dashboard")
        ) {
          diagnostics.push({
            file: relative,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            rule: "boundaries/core-isolation",
            message: "Core must not import UI, server frameworks, or adapter packages.",
          });
        }
      }

      if (
        relative.startsWith("packages/dashboard/src/") &&
        !relative.includes(".test.") &&
        !relative.includes(".spec.")
      ) {
        if (
          specifier === "@agent-harness/core" ||
          (specifier.startsWith("@agent-harness/core/") &&
            !specifier.startsWith("@agent-harness/core/contracts"))
        ) {
          diagnostics.push({
            file: relative,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            rule: "boundaries/dashboard-contracts-only",
            message:
              "Dashboard must only import from @agent-harness/core/contracts, not core runtime.",
          });
        }
        if (
          specifier === "express" ||
          specifier === "socket.io" ||
          specifier.startsWith("@agent-harness/server")
        ) {
          diagnostics.push({
            file: relative,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            rule: "boundaries/dashboard-isolation",
            message: "Dashboard must not import server modules or packages.",
          });
        }
      }

      if (
        relative.startsWith("packages/server/src/") &&
        !relative.includes(".test.") &&
        !relative.includes(".spec.")
      ) {
        if (specifier.startsWith("@agent-harness/dashboard")) {
          diagnostics.push({
            file: relative,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            rule: "boundaries/server-isolation",
            message: "Server must not import dashboard modules or packages.",
          });
        }
      }
    }

    if (
      relative.startsWith("packages/core/src/") &&
      !relative.includes(".test.") &&
      !relative.includes(".spec.") &&
      !relative.startsWith("packages/core/src/persistence/") &&
      !relative.startsWith("packages/core/src/tool/") &&
      relative !== "packages/core/src/presentation/inbox.ts" &&
      relative !== "packages/core/src/filesystem/bounded-io.ts"
    ) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ["fs", "fsExtra", "promises"].includes(node.expression.expression.text) &&
        [
          "writeFile",
          "writeFileSync",
          "outputFile",
          "outputFileSync",
          "rm",
          "rmSync",
          "remove",
          "removeSync",
        ].includes(node.expression.name.text)
      ) {
        diagnostics.push({
          file: relative,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          rule: "persistence/single-writer-only",
          message:
            "Direct filesystem write operations in core must be owned by SessionStore, BoundedIO, InboxManager, or workspace tools.",
        });
      }
    }

    ts.forEachChild(node, visit);
  }
}

/** @param {ts.Node} node */
function isAsyncFunction(node) {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

/** @param {ts.Node} node @param {string} name */
function isWithinCallNamed(node, name) {
  let current = node.parent;
  while (current && !ts.isStatement(current)) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === name
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** @param {string} rootDir @param {(file: string) => boolean} predicate */
function findFiles(rootDir, predicate) {
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(path.join(directory, entry.name));
        continue;
      }
      const file = path.join(directory, entry.name);
      if (entry.isFile() && predicate(file)) found.push(file);
    }
  }
  return found;
}

/** @param {string} rootDir @param {string} filePath */
function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

/** @param {string} source @param {number} offset */
function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  const diagnostics = checkQualityPolicy(process.cwd());
  if (diagnostics.length === 0) {
    console.log("Quality policy passed.");
  } else {
    for (const diagnostic of diagnostics) {
      const location = diagnostic.line ? `${diagnostic.file}:${diagnostic.line}` : diagnostic.file;
      console.error(`${location} [${diagnostic.rule}] ${diagnostic.message}`);
    }
    process.exitCode = 1;
  }
}
