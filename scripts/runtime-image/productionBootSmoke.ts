import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOOT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 5_000;

export type BootSmokeOptions = {
  port?: number;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
};

export type BootSmokeResult = {
  ok: boolean;
  port: number;
  readyLine: string | null;
  healthStatus: number | null;
  healthBody: unknown;
  errors: string[];
  logs: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(
  child: ChildProcess,
  logs: string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for server ready line`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      logs.push(text);
      if (text.includes("Ready on http://")) {
        settled = true;
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        const line = text.split("\n").find((row) => row.includes("Ready on http://")) ?? text.trim();
        resolve(line);
      }
      if (text.includes("ERR_UNKNOWN_FILE_EXTENSION") || text.includes("MODULE_NOT_FOUND")) {
        clearTimeout(timer);
        reject(new Error(`Fatal boot error detected in logs: ${text.trim()}`));
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      reject(new Error(`Server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
  });
}

async function fetchHealth(port: number): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function shutdownChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.killed) return;
  const pid = child.pid;
  if (pid == null) return;

  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
    }),
    sleep(SHUTDOWN_GRACE_MS).then(() => false),
  ]);

  if (!exited) {
    try {
      if (process.platform !== "win32") {
        process.kill(-pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      sleep(SHUTDOWN_GRACE_MS).then(() => undefined),
    ]);
  }
}

export async function runProductionBootSmoke(
  options: BootSmokeOptions = {}
): Promise<BootSmokeResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const port = options.port ?? 3099;
  const dataDir = mkdtempSync(join(tmpdir(), "runtime-boot-smoke-"));
  const logs: string[] = [];
  const errors: string[] = [];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DATA_DIR: dataDir,
    SESSION_SECRET: "01234567890123456789012345678901",
    WITHDRAWAL_ENCRYPTION_KEY: "01234567890123456789012345678901",
    DISABLE_PAYOUT_SCHEDULER: "1",
    DISABLE_FINANCE_SCHEDULER: "1",
    DISABLE_DERIVED_CACHE_WORKER: "1",
    REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
    DISABLE_WEB_PUSH: "1",
    ...options.env,
  };

  const child = spawn("npm", ["run", "start"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let readyLine: string | null = null;
  let healthStatus: number | null = null;
  let healthBody: unknown = null;

  try {
    readyLine = await waitForReady(child, logs, BOOT_TIMEOUT_MS);
    const health = await fetchHealth(port);
    healthStatus = health.status;
    healthBody = health.body;

    if (health.status !== 200) {
      errors.push(`GET /health returned HTTP ${health.status}`);
    } else if (
      health.body == null ||
      typeof health.body !== "object" ||
      !("status" in health.body) ||
      (health.body as { status?: string }).status !== "ok"
    ) {
      errors.push(`GET /health body was not { status: "ok" }: ${JSON.stringify(health.body)}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await shutdownChild(child);
  }

  return {
    ok: errors.length === 0,
    port,
    readyLine,
    healthStatus,
    healthBody,
    errors,
    logs,
  };
}

async function main(): Promise<void> {
  const result = await runProductionBootSmoke();
  if (result.readyLine) {
    console.log(`READY: ${result.readyLine.trim()}`);
  }
  console.log(`HEALTH: status=${result.healthStatus} body=${JSON.stringify(result.healthBody)}`);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`FAIL: ${error}`);
    }
    if (result.logs.length > 0) {
      console.error("--- boot logs (tail) ---");
      console.error(result.logs.join("").slice(-4000));
    }
    process.exit(1);
  }
  console.log("PASS: production boot smoke succeeded");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
