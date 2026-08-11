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
    ...findFiles(absoluteRoot, (file) => SOURCE_EXTENSIONS.has(path.extname(file))).flatMap(
      (file) => checkSourceFile(absoluteRoot, file),
    ),
  ].sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

/** @param {string} rootDir */
function checkTypeScriptConfigs(rootDir) {
  const configFiles = findFiles(
    rootDir,
    (file) =>
      path.basename(file) === "tsconfig.json" || path.basename(file) === "tsconfig.base.json",
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
      /@ts-(?:ignore|nocheck)/.test(scanner.getTokenText())
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

    ts.forEachChild(node, visit);
  }
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
