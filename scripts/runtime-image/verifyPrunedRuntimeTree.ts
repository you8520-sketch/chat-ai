import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  FORBIDDEN_NODE_MODULES_DIRS,
  FORBIDDEN_ROOT_RUNTIME_PACKAGES,
  REQUIRED_ROOT_RUNTIME_PACKAGES,
} from "./runtimeTreeExpectations.ts";

export type RuntimeTreeVerification = {
  ok: boolean;
  nodeModulesPath: string;
  rootPackages: string[];
  packageCount: number;
  approximateSize: string;
  failures: string[];
  notes: string[];
};

function parseRootProductionPackages(repoRoot: string): string[] {
  const output = execSync("npm ls --omit=dev --depth=0 --parseable", {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const rootNodeModules = join(repoRoot, "node_modules") + "/";
  const packages: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(rootNodeModules)) continue;
    const rel = trimmed.slice(rootNodeModules.length);
    if (!rel || rel.includes("/node_modules/")) continue;
    packages.push(rel.split("/node_modules/").pop() ?? rel);
  }
  return [...new Set(packages)].sort();
}

export function verifyPrunedRuntimeTree(
  repoRoot: string = process.cwd()
): RuntimeTreeVerification {
  const nodeModulesPath = join(repoRoot, "node_modules");
  const failures: string[] = [];
  const notes: string[] = [];

  if (!existsSync(nodeModulesPath)) {
    return {
      ok: false,
      nodeModulesPath,
      rootPackages: [],
      packageCount: 0,
      approximateSize: "0",
      failures: ["node_modules directory is missing"],
      notes,
    };
  }

  let rootPackages: string[] = [];
  try {
    rootPackages = parseRootProductionPackages(repoRoot);
  } catch (error) {
    failures.push(
      `Could not parse root production package list: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  for (const pkg of REQUIRED_ROOT_RUNTIME_PACKAGES) {
    if (!rootPackages.includes(pkg)) {
      failures.push(`MISSING required root runtime package: ${pkg}`);
    }
  }

  for (const pkg of FORBIDDEN_ROOT_RUNTIME_PACKAGES) {
    if (rootPackages.includes(pkg)) {
      failures.push(`FORBIDDEN root runtime package still present: ${pkg}`);
    }
  }

  for (const dir of FORBIDDEN_NODE_MODULES_DIRS) {
    if (existsSync(join(nodeModulesPath, dir))) {
      failures.push(`FORBIDDEN build/test module directory still present: ${dir}`);
    }
  }

  const require = createRequire(join(repoRoot, "package.json"));
  try {
    require.resolve("tsx");
    notes.push("tsx resolves via Node module graph");
  } catch {
    failures.push("tsx does not resolve after prune");
  }

  if (existsSync(join(nodeModulesPath, "@playwright/test"))) {
    notes.push(
      "@playwright/test directory may remain nested via next peerOptional; verified absent from root production deps"
    );
  }

  try {
    require.resolve("jsdom");
    notes.push("jsdom remains as production transitive dependency (isomorphic-dompurify / next externals)");
  } catch {
    notes.push("jsdom not directly resolvable after prune");
  }

  try {
    require.resolve("esbuild");
    notes.push("esbuild remains as tsx transitive runtime dependency");
  } catch {
    failures.push("esbuild missing but required by tsx runtime loader");
  }

  let packageCount = 0;
  let approximateSize = "unknown";
  try {
    packageCount = Number(
      execSync("ls -1 node_modules | wc -l", { cwd: repoRoot, encoding: "utf8" }).trim()
    );
    approximateSize = execSync("du -sh node_modules", { cwd: repoRoot, encoding: "utf8" })
      .trim()
      .split(/\s+/)[0] ?? "unknown";
  } catch {
    notes.push("Could not measure node_modules size/count");
  }

  return {
    ok: failures.length === 0,
    nodeModulesPath,
    rootPackages,
    packageCount,
    approximateSize,
    failures,
    notes,
  };
}

function main(): void {
  const result = verifyPrunedRuntimeTree();
  console.log(`Root production packages: ${result.rootPackages.join(", ")}`);
  for (const note of result.notes) {
    console.log(`NOTE: ${note}`);
  }
  console.log(
    `Runtime tree: packages=${result.packageCount} size=${result.approximateSize} path=${result.nodeModulesPath}`
  );
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`FAIL: ${failure}`);
    }
    process.exit(1);
  }
  console.log("PASS: pruned runtime tree matches expectations");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
