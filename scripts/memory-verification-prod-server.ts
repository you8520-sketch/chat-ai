#!/usr/bin/env tsx
/**
 * Production-mode Memory v2 / RP verification server (local only).
 *
 * - DISABLE_DERIVED_CACHE_WORKER=1 (no background prompt-translation drain)
 * - Isolated DATA_DIR per role (baseline vs pr)
 * - PLAYWRIGHT_PROD_SERVER=1 for ephemeral local DATA_DIR under production runtime
 * - Cleans up the child server on exit / signals
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/memory-verification-prod-server.ts baseline|pr [--port N] [--data-dir PATH]
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  defaultMemoryVerificationPort,
  resolveMemoryVerificationProdServerEnv,
  type MemoryVerificationServerRole,
} from "./lib/memoryVerificationProdServerEnv";

function parseArgs(argv: string[]): {
  role: MemoryVerificationServerRole;
  port?: number;
  dataDir?: string;
} {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const role = positional[0] as MemoryVerificationServerRole | undefined;
  if (role !== "baseline" && role !== "pr") {
    throw new Error("Usage: memory-verification-prod-server.ts baseline|pr [--port N] [--data-dir PATH]");
  }
  let port: number | undefined;
  let dataDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") port = Number(argv[i + 1]);
    if (argv[i] === "--data-dir") dataDir = argv[i + 1];
  }
  if (port != null && (!Number.isFinite(port) || port <= 0)) {
    throw new Error(`Invalid --port ${String(port)}`);
  }
  return { role, port, dataDir };
}

let child: ChildProcess | null = null;

function shutdown(reason: string, code = 0): void {
  if (child && child.pid && !child.killed) {
    console.log(`[memory-verification-server] stopping child pid=${child.pid} (${reason})`);
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), reason === "signal" ? 0 : 100).unref();
}

function main(): void {
  const { role, port, dataDir } = parseArgs(process.argv.slice(2));
  const env = resolveMemoryVerificationProdServerEnv({ role, port, dataDir });
  const listenPort = env.PORT ?? String(defaultMemoryVerificationPort(role));
  const serverJs = path.join(process.cwd(), "server.js");
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  console.log(
    `[memory-verification-server] role=${role} port=${listenPort} DATA_DIR=${env.DATA_DIR} DISABLE_DERIVED_CACHE_WORKER=${env.DISABLE_DERIVED_CACHE_WORKER}`
  );

  child = spawn(tsxBin, [serverJs], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    child = null;
    if (signal) {
      process.exit(0);
      return;
    }
    process.exit(code ?? 1);
  });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => shutdown("signal"));
  }
}

main();
