#!/usr/bin/env tsx
/**
 * Production-mode Memory v2 / RP verification server (local only).
 *
 * Isolated DATA_DIR per role. Translation worker stays off via the canonical
 * derived-cache enablement owner (NODE_ENV=production is not a deploy context).
 * Reaps the owned tsx/server.js process group on exit.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/memory-verification-prod-server.ts baseline|pr [--port N] [--data-dir PATH]
 */
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  spawnOwnedDetachedChild,
  stopOwnedChildProcess,
} from "./lib/ownedChildProcess";
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
let shuttingDown = false;

async function shutdown(reason: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const owned = child;
  child = null;
  const result = await stopOwnedChildProcess(owned);
  if (result.pid != null) {
    console.log(
      `[memory-verification-server] stopped owned child pid=${result.pid} reason=${reason} exited=${result.exited} usedKill=${result.usedKill}`
    );
  }
  process.exit(code);
}

function main(): void {
  const { role, port, dataDir } = parseArgs(process.argv.slice(2));
  const env = resolveMemoryVerificationProdServerEnv({ role, port, dataDir });
  const listenPort = env.PORT ?? String(defaultMemoryVerificationPort(role));
  const serverJs = path.join(process.cwd(), "server.js");
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");

  console.log(
    `[memory-verification-server] role=${role} port=${listenPort} DATA_DIR=${env.DATA_DIR}`
  );

  child = spawnOwnedDetachedChild(tsxBin, [serverJs], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  console.log(`[memory-verification-server] owned child pid=${child.pid ?? "none"}`);

  child.on("exit", (exitCode, signal) => {
    child = null;
    if (shuttingDown) return;
    if (signal) {
      process.exit(0);
      return;
    }
    process.exit(exitCode ?? 1);
  });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }
}

main();
