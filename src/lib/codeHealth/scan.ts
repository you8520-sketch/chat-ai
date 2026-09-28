import fs from "node:fs";
import path from "node:path";

import {
  isFrameworkEntry,
  isIgnoredScanPath,
  isKeepPackage,
  isKeepPath,
  isNextSpecialExport,
  isProtectedBoundaryPath,
  isSchedulerOnlyEntry,
  toPosix,
} from "@/lib/codeHealth/keep";
import { CODE_HEALTH_OWNER_MAP } from "@/lib/codeHealth/ownerMap";
import type { CodeHealthCandidate, CodeHealthKind } from "@/lib/codeHealth/types";
import { candidateIdentity } from "@/lib/codeHealth/types";

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:declare\s+)?(?:type|interface|enum|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s+(?:type\s+)?\{([^}]+)\}/gm;
const ENV_USE_RE = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\])/g;
const TODO_RE = /\b(TODO|FIXME|HACK)\b/g;
const DEBUG_RE = /\bdebugger\b|console\.(?:debug|log)\(\s*["']DEBUG/g;

export type ScannedFile = {
  relPath: string;
  absPath: string;
  text: string;
};

export type ImportGraph = {
  files: Map<string, ScannedFile>;
  importedBy: Map<string, Set<string>>;
  importedSymbols: Map<string, Set<string>>;
  dynamicTargets: Set<string>;
  specifiers: Set<string>;
};

export function walkSourceFiles(repoRoot: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  const visit = (absDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = toPosix(path.relative(repoRoot, absPath));
      if (isIgnoredScanPath(relPath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
        visit(absPath);
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(entry.name)) && !relPath.endsWith(".env.example")) continue;
      let text = "";
      try {
        text = fs.readFileSync(absPath, "utf8");
      } catch {
        continue;
      }
      out.push({ relPath, absPath, text });
    }
  };
  visit(repoRoot);
  return out;
}

function tryResolveImport(fromRel: string, spec: string, files: Map<string, ScannedFile>): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const fromDir = path.posix.dirname(fromRel);
  const raw = spec.startsWith("@/")
    ? path.posix.join("src", spec.slice(2))
    : toPosix(path.posix.normalize(path.posix.join(fromDir, spec)));
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.jsx`,
    `${raw}.mjs`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
    `${raw}/index.js`,
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return raw;
}

export function buildImportGraph(files: ScannedFile[]): ImportGraph {
  const fileMap = new Map(files.map((file) => [file.relPath, file]));
  const importedBy = new Map<string, Set<string>>();
  const importedSymbols = new Map<string, Set<string>>();
  const dynamicTargets = new Set<string>();
  const specifiers = new Set<string>();

  const addImport = (target: string, from: string, dynamic: boolean) => {
    if (!importedBy.has(target)) importedBy.set(target, new Set());
    importedBy.get(target)!.add(from);
    if (dynamic) dynamicTargets.add(target);
  };

  for (const file of files) {
    const namedImportRe =
      /import\s+(?:type\s+)?(?:[\w${}*,\s]+)\s+from\s+["']([^"']+)["']/g;
    let named: RegExpExecArray | null;
    while ((named = namedImportRe.exec(file.text))) {
      const spec = named[1]!;
      specifiers.add(spec.split("/")[0]!.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
      const resolved = tryResolveImport(file.relPath, spec, fileMap);
      if (resolved) addImport(resolved, file.relPath, false);
      const brace = named[0].match(/\{([^}]+)\}/);
      if (brace && resolved) {
        if (!importedSymbols.has(resolved)) importedSymbols.set(resolved, new Set());
        for (const part of brace[1]!.split(",")) {
          const ident = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (ident) importedSymbols.get(resolved)!.add(ident);
        }
      }
    }

    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    const localImportRe =
      /import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = localImportRe.exec(file.text))) {
      const spec = match[1] || match[2];
      if (!spec) continue;
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
      if (!spec.startsWith(".") && !spec.startsWith("@/")) specifiers.add(pkg);
      const resolved = tryResolveImport(file.relPath, spec, fileMap);
      if (resolved) addImport(resolved, file.relPath, true);
    }
  }

  return { files: fileMap, importedBy, importedSymbols, dynamicTargets, specifiers };
}

function makeCandidate(partial: Omit<CodeHealthCandidate, "id">): CodeHealthCandidate {
  return { ...partial, id: candidateIdentity(partial) };
}

function emptyEvidence(): CodeHealthCandidate["evidence"] {
  return {
    writerPresent: null,
    readerPresent: null,
    staticReferences: 0,
    dynamicOrRuntimeReferences: 0,
    productionExecutionPath: null,
    dbExistingDataImpact: null,
    rollbackOrCompatibilityImpact: null,
  };
}

export function listExportedNames(text: string): string[] {
  const names = new Set<string>();
  EXPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_RE.exec(text))) names.add(match[1]!);
  EXPORT_LIST_RE.lastIndex = 0;
  while ((match = EXPORT_LIST_RE.exec(text))) {
    for (const part of match[1]!.split(",")) {
      const ident = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (ident) names.add(ident);
    }
  }
  if (/^export\s+default\b/m.test(text)) names.add("default");
  return [...names];
}

export function scanUnusedFiles(graph: ImportGraph): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  for (const [relPath, file] of graph.files) {
    if (!SOURCE_EXT.has(path.extname(relPath))) continue;
    if (
      isFrameworkEntry(relPath) ||
      isSchedulerOnlyEntry(relPath) ||
      relPath.startsWith("scripts/") ||
      relPath.startsWith(".github/") ||
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(relPath)
    ) {
      continue;
    }
    const importers = graph.importedBy.get(relPath);
    const staticCount = importers?.size ?? 0;
    const dynamic = graph.dynamicTargets.has(relPath);
    if (staticCount > 0 || dynamic) continue;
    const base = path.posix.basename(relPath);
    const pathMentions = [...graph.files.values()].filter((other) => {
      if (other.relPath === relPath) return false;
      return other.text.includes(relPath) || other.text.includes(`/${base}`);
    }).length;
    out.push(
      makeCandidate({
        kind: "unused_file",
        classification: "UNCONFIRMED",
        path: relPath,
        symbol: null,
        summary: `No static importer found for ${relPath}`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: false,
          readerPresent: pathMentions > 0,
          staticReferences: staticCount,
          dynamicOrRuntimeReferences: pathMentions,
          productionExecutionPath: isProtectedBoundaryPath(relPath) ? true : false,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: false,
        },
        stopReasons: [],
        bugfix: false,
        knipEquivalent: true,
      })
    );
  }
  return out;
}

export function scanUnusedExports(graph: ImportGraph): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  for (const [relPath, file] of graph.files) {
    if (!SOURCE_EXT.has(path.extname(relPath))) continue;
    if (isFrameworkEntry(relPath) || relPath.startsWith("scripts/")) continue;
    const exported = listExportedNames(file.text);
    const imported = graph.importedSymbols.get(relPath) ?? new Set();
    for (const name of exported) {
      if (isNextSpecialExport(name)) continue;
      if (imported.has(name)) continue;
      const runtimeHits = [...graph.files.values()].filter(
        (other) => other.relPath !== relPath && other.text.includes(name)
      ).length;
      out.push(
        makeCandidate({
          kind: "unused_export",
          classification: "UNCONFIRMED",
          path: relPath,
          symbol: name,
          summary: `Export ${name} has no named importer in ${relPath}`,
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: runtimeHits > 0,
            staticReferences: 0,
            dynamicOrRuntimeReferences: runtimeHits,
            productionExecutionPath: isProtectedBoundaryPath(relPath) ? true : null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: true,
        })
      );
    }
  }
  return out;
}

export function scanUnusedDependencies(
  repoRoot: string,
  specifiers: Set<string>
): CodeHealthCandidate[] {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const out: CodeHealthCandidate[] = [];
  for (const [section, deps] of [
    ["dependencies", pkg.dependencies ?? {}],
    ["devDependencies", pkg.devDependencies ?? {}],
  ] as const) {
    for (const name of Object.keys(deps)) {
      if (isKeepPackage(name)) continue;
      if (specifiers.has(name)) continue;
      out.push(
        makeCandidate({
          kind: "unused_dependency",
          classification: "UNCONFIRMED",
          path: "package.json",
          symbol: name,
          summary: `${section} ${name} has no import specifier`,
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: false,
            staticReferences: 0,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: section === "dependencies" ? null : false,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: true,
        })
      );
    }
  }
  return out;
}

export function parseEnvExampleKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/);
    if (match) keys.push(match[1]!);
  }
  return keys;
}

export function scanEnvAndFlags(files: ScannedFile[]): CodeHealthCandidate[] {
  const envExample = files.find((file) => file.relPath === ".env.example");
  const documented = new Set(envExample ? parseEnvExampleKeys(envExample.text) : []);
  const used = new Map<string, number>();
  for (const file of files) {
    ENV_USE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENV_USE_RE.exec(file.text))) {
      const key = match[1] || match[2];
      if (!key) continue;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  }
  const out: CodeHealthCandidate[] = [];
  for (const key of documented) {
    if (used.has(key)) continue;
    const flagLike = /ENABLED|KILL_SWITCH|CANARY|FEATURE|MODE|FALLBACK|DISABLE/.test(key);
    out.push(
      makeCandidate({
        kind: flagLike ? "obsolete_feature_flag" : "unused_env_var",
        classification: "UNCONFIRMED",
        path: ".env.example",
        symbol: key,
        summary: `${key} is documented in .env.example but has no process.env reader`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: false,
          staticReferences: 0,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: null,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: true,
        },
        stopReasons: [],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function scanTodosAndDebug(files: ScannedFile[]): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  for (const file of files) {
    if (!SOURCE_EXT.has(path.extname(file.relPath))) continue;
    const todos = file.text.match(TODO_RE) ?? [];
    if (todos.length > 0) {
      out.push(
        makeCandidate({
          kind: "todo_fixme_hack",
          classification: "FOLLOW_UP",
          path: file.relPath,
          symbol: null,
          summary: `${todos.length} TODO/FIXME/HACK marker(s)`,
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: true,
            staticReferences: todos.length,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: isProtectedBoundaryPath(file.relPath) ? true : null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: false,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
    if (DEBUG_RE.test(file.text) || /temporary debug|TMP DEBUG|XXX debug/i.test(file.text)) {
      DEBUG_RE.lastIndex = 0;
      out.push(
        makeCandidate({
          kind: "temporary_debug",
          classification: "FOLLOW_UP",
          path: file.relPath,
          symbol: null,
          summary: "Temporary debug marker",
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: true,
            staticReferences: 1,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: false,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
    if (/(?:compat(?:ibility)?\s+shim|legacy shim|deprecated workaround)/i.test(file.text)) {
      out.push(
        makeCandidate({
          kind: "compatibility_shim",
          classification: "FOLLOW_UP",
          path: file.relPath,
          symbol: null,
          summary: "Compatibility shim / legacy workaround comment",
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: true,
            staticReferences: 1,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: null,
            dbExistingDataImpact: null,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
    if (/if\s*\(\s*false\s*\)|if\s*\(\s*0\s*\)/.test(file.text)) {
      out.push(
        makeCandidate({
          kind: "unreachable_branch",
          classification: "UNCONFIRMED",
          path: file.relPath,
          symbol: null,
          summary: "Literal unreachable branch (if (false) / if (0))",
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: false,
            staticReferences: 1,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: false,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: null,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
  }
  return out;
}

export function scanDuplicateHelpers(files: ScannedFile[]): CodeHealthCandidate[] {
  const exported = new Map<string, string[]>();
  for (const file of files) {
    if (!file.relPath.startsWith("src/lib/")) continue;
    if (file.relPath.includes(".test.")) continue;
    for (const name of listExportedNames(file.text)) {
      if (isNextSpecialExport(name) || name === "default") continue;
      const list = exported.get(name) ?? [];
      list.push(file.relPath);
      exported.set(name, list);
    }
  }
  const out: CodeHealthCandidate[] = [];
  for (const [name, paths] of exported) {
    const unique = [...new Set(paths)];
    if (unique.length < 2) continue;
    out.push(
      makeCandidate({
        kind: "duplicate_helper",
        classification: "UNCONFIRMED",
        path: unique.join(" | "),
        symbol: name,
        summary: `Exported identifier ${name} appears in ${unique.length} lib modules`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: true,
          staticReferences: unique.length,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: unique.some(isProtectedBoundaryPath) ? true : null,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: true,
        },
        stopReasons: [],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function scanPromptAndAdapters(
  files: ScannedFile[],
  graph: ImportGraph
): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  const promptLines = new Map<string, string[]>();
  for (const file of files) {
    const posix = file.relPath;
    if (/prompt/i.test(posix) && SOURCE_EXT.has(path.extname(posix))) {
      for (const line of file.text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length < 48 || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (!/[가-힣A-Za-z]/.test(trimmed)) continue;
        const list = promptLines.get(trimmed) ?? [];
        if (!list.includes(posix)) list.push(posix);
        promptLines.set(trimmed, list);
      }
      const builders = [...file.text.matchAll(/export\s+function\s+(build\w*Prompt\w*)/g)].map(
        (match) => match[1]!
      );
      const imported = graph.importedSymbols.get(posix) ?? new Set();
      for (const name of builders) {
        if (imported.has(name)) continue;
        out.push(
          makeCandidate({
            kind: "unused_prompt_builder",
            classification: "UNCONFIRMED",
            path: posix,
            symbol: name,
            summary: `Prompt builder ${name} has no named importer`,
            evidence: {
              ...emptyEvidence(),
              writerPresent: true,
              readerPresent: null,
              staticReferences: 0,
              dynamicOrRuntimeReferences: 0,
              productionExecutionPath: null,
              dbExistingDataImpact: false,
              rollbackOrCompatibilityImpact: true,
            },
            stopReasons: [],
            bugfix: false,
            knipEquivalent: false,
          })
        );
      }
    }
    if (/Adapter/i.test(posix) && !graph.importedBy.has(posix) && !isKeepPath(posix)) {
      out.push(
        makeCandidate({
          kind: "obsolete_model_adapter",
          classification: "UNCONFIRMED",
          path: posix,
          symbol: null,
          summary: "Adapter module has no static importer",
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: false,
            staticReferences: 0,
            dynamicOrRuntimeReferences: graph.dynamicTargets.has(posix) ? 1 : 0,
            productionExecutionPath: null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
    if (/FALLBACK|fallback/.test(file.text) && /dead fallback|unused fallback|legacy fallback/i.test(file.text)) {
      out.push(
        makeCandidate({
          kind: "dead_fallback",
          classification: "FOLLOW_UP",
          path: posix,
          symbol: null,
          summary: "Commented or labeled dead/legacy fallback",
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: null,
            staticReferences: 1,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: false,
        })
      );
    }
  }
  let promptDup = 0;
  for (const [line, paths] of promptLines) {
    if (paths.length < 2) continue;
    promptDup += 1;
    if (promptDup > 20) break;
    out.push(
      makeCandidate({
        kind: "duplicate_prompt_section",
        classification: "FOLLOW_UP",
        path: paths.join(" | "),
        symbol: line.slice(0, 80),
        summary: "Duplicate prompt line across files",
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: true,
          staticReferences: paths.length,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: true,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: true,
        },
        stopReasons: [],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function scanDuplicateOwners(): CodeHealthCandidate[] {
  const claimed = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(CODE_HEALTH_OWNER_MAP)) {
    const list = claimed.get(entry.responsibility) ?? [];
    list.push(key);
    claimed.set(entry.responsibility, list);
  }
  const out: CodeHealthCandidate[] = [];
  for (const [responsibility, keys] of claimed) {
    if (keys.length < 2) continue;
    out.push(
      makeCandidate({
        kind: "duplicate_canonical_owner",
        classification: "REQUIRED_CLEANUP",
        path: keys.join(" | "),
        symbol: responsibility,
        summary: `Responsibility claimed by ${keys.length} owner-map keys`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: true,
          staticReferences: keys.length,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: false,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: false,
        },
        stopReasons: ["canonical_owner_mismatch"],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function scanDbFields(files: ScannedFile[]): CodeHealthCandidate[] {
  const dbFile = files.find((file) => file.relPath === "src/lib/db.ts");
  if (!dbFile) return [];
  const columns = new Set<string>();
  const colRe = /^\s{2,6}([a-z_][a-z0-9_]*)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/gim;
  let match: RegExpExecArray | null;
  while ((match = colRe.exec(dbFile.text))) {
    const name = match[1]!;
    if (name === "id" || name === "created_at" || name === "updated_at") continue;
    columns.add(name);
  }
  const remnantRe = /CREATE TABLE[^\n]*(_mig|_v2)\b/gi;
  const out: CodeHealthCandidate[] = [];
  while ((match = remnantRe.exec(dbFile.text))) {
    out.push(
      makeCandidate({
        kind: "stale_migration_remnant",
        classification: "FOLLOW_UP",
        path: "src/lib/db.ts",
        symbol: match[0],
        summary: "Migration remnant table name in db.ts",
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: null,
          staticReferences: 1,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: true,
          dbExistingDataImpact: true,
          rollbackOrCompatibilityImpact: true,
        },
        stopReasons: ["destructive_migration"],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  let gaps = 0;
  for (const column of columns) {
    let hits = 0;
    for (const file of files) {
      if (file.relPath === "src/lib/db.ts") continue;
      if (file.text.includes(column)) hits += 1;
      if (hits > 1) break;
    }
    if (hits > 0) continue;
    gaps += 1;
    if (gaps > 25) break;
    out.push(
      makeCandidate({
        kind: "db_field_writer_reader_gap",
        classification: "UNCONFIRMED",
        path: "src/lib/db.ts",
        symbol: column,
        summary: `Column ${column} has no extra-schema text reference`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: null,
          readerPresent: false,
          staticReferences: 0,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: null,
          dbExistingDataImpact: true,
          rollbackOrCompatibilityImpact: true,
        },
        stopReasons: ["destructive_migration", "unconfirmed_production_usage"],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function scanCriticalSecrets(files: ScannedFile[]): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  const openRouterPrefix = "sk-or";
  const anthropicPrefix = "sk-ant";
  const secretRe = new RegExp(
    `(?:${openRouterPrefix}-|${anthropicPrefix}-|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA )?PRIVATE KEY-----)`
  );
  for (const file of files) {
    if (file.relPath.startsWith("src/lib/codeHealth/")) continue;
    if (file.relPath.includes(".env") || !SOURCE_EXT.has(path.extname(file.relPath))) continue;
    if (!secretRe.test(file.text)) continue;
    out.push(
      makeCandidate({
        kind: "critical_bugfix",
        classification: "REQUIRED_CLEANUP",
        path: file.relPath,
        symbol: null,
        summary: "Possible embedded credential / private key — weekly job will not patch",
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: true,
          staticReferences: 1,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: true,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: false,
        },
        stopReasons: ["security_auth_adult_boundary"],
        bugfix: true,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export type GithubFailedRun = {
  name: string;
  path: string;
  conclusion: string | null;
  createdAt: string;
  htmlUrl: string;
};

export function scanCiAnomalies(runs: GithubFailedRun[]): CodeHealthCandidate[] {
  const groups = new Map<string, GithubFailedRun[]>();
  for (const run of runs) {
    const key = `${run.name}::${run.path}`;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  const out: CodeHealthCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    out.push(
      makeCandidate({
        kind: "ci_runtime_error",
        classification: "FOLLOW_UP",
        path: list[0]!.path,
        symbol: list[0]!.name,
        summary: `${list.length} recent non-success scheduled/CI runs for ${key}`,
        evidence: {
          ...emptyEvidence(),
          writerPresent: true,
          readerPresent: true,
          staticReferences: list.length,
          dynamicOrRuntimeReferences: 0,
          productionExecutionPath: true,
          dbExistingDataImpact: false,
          rollbackOrCompatibilityImpact: false,
        },
        stopReasons: [],
        bugfix: false,
        knipEquivalent: false,
      })
    );
  }
  return out;
}

export function unusedHelperCandidates(graph: ImportGraph): CodeHealthCandidate[] {
  const out: CodeHealthCandidate[] = [];
  for (const [relPath, file] of graph.files) {
    if (!relPath.startsWith("src/lib/")) continue;
    const fns = [...file.text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(
      (match) => match[1]!
    );
    const imported = graph.importedSymbols.get(relPath) ?? new Set();
    for (const name of fns) {
      if (imported.has(name)) continue;
      out.push(
        makeCandidate({
          kind: name === name.toUpperCase() ? "unused_constant" : "unused_helper",
          classification: "UNCONFIRMED",
          path: relPath,
          symbol: name,
          summary: `Exported helper/constant ${name} has no named importer`,
          evidence: {
            ...emptyEvidence(),
            writerPresent: true,
            readerPresent: null,
            staticReferences: 0,
            dynamicOrRuntimeReferences: 0,
            productionExecutionPath: isProtectedBoundaryPath(relPath) ? true : null,
            dbExistingDataImpact: false,
            rollbackOrCompatibilityImpact: true,
          },
          stopReasons: [],
          bugfix: false,
          knipEquivalent: true,
        })
      );
    }
  }
  return out;
}

export function allScanCandidates(params: {
  repoRoot: string;
  files: ScannedFile[];
  graph: ImportGraph;
  ciRuns: GithubFailedRun[];
}): CodeHealthCandidate[] {
  return [
    ...scanUnusedFiles(params.graph),
    ...scanUnusedExports(params.graph),
    ...scanUnusedDependencies(params.repoRoot, params.graph.specifiers),
    ...unusedHelperCandidates(params.graph),
    ...scanEnvAndFlags(params.files),
    ...scanTodosAndDebug(params.files),
    ...scanDuplicateHelpers(params.files),
    ...scanPromptAndAdapters(params.files, params.graph),
    ...scanDuplicateOwners(),
    ...scanDbFields(params.files),
    ...scanCriticalSecrets(params.files),
    ...scanCiAnomalies(params.ciRuns),
  ];
}

export type { CodeHealthKind };
