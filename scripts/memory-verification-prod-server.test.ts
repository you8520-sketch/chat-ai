import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import Database from "better-sqlite3";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ensureDerivedCacheJobsTable,
  enqueueDerivedCacheJob,
} from "../src/lib/derivedCache/jobs.ts";
import { TRANSLATION_DERIVATION_VERSION, worldContentFingerprint } from "../src/lib/derivedCache/versions.ts";
import { isPidAlive } from "./lib/ownedChildProcess";
import { resolveMemoryVerificationProdServerEnv } from "./lib/memoryVerificationProdServerEnv";

const WORLD_CONTENT = "검증 서버 번역 큐 고정. ".repeat(6);
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const SERVER_JS = path.join(process.cwd(), "server.js");
const LAUNCHER = path.join(process.cwd(), "scripts", "memory-verification-prod-server.ts");

function listenFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function seedPendingTranslationJob(dataDir: string): { jobId: number } {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "app.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, pw_hash TEXT, points INTEGER DEFAULT 0, is_adult INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER, name TEXT, summary TEXT, content TEXT, updated_at TEXT
    );
  `);
  ensureDerivedCacheJobsTable(db);
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
  ).run(98101, "verify-server@test.local", "verify", "hash");
  const worldId = Number(
    db
      .prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
         VALUES (98101, 'Verify', 's', ?, datetime('now'))`
      )
      .run(WORLD_CONTENT).lastInsertRowid
  );
  enqueueDerivedCacheJob(db, {
    jobKind: "world_translate",
    entityType: "world",
    entityId: worldId,
    sourceFingerprint: worldContentFingerprint(WORLD_CONTENT),
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
  });
  const row = db.prepare(`SELECT id FROM derived_cache_jobs WHERE entity_id=?`).get(worldId) as {
    id: number;
  };
  db.close();
  return { jobId: row.id };
}

function readJobRow(dataDir: string, jobId: number): { status: string; attempts: number } {
  const db = new Database(path.join(dataDir, "app.db"), { readonly: true });
  const row = db
    .prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE id=?`)
    .get(jobId) as { status: string; attempts: number };
  db.close();
  return row;
}

function spawnEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.DISABLE_DERIVED_CACHE_WORKER;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  return env;
}

async function waitLog(logPath: string, predicate: (log: string) => boolean, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let log = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    if (predicate(log)) return log;
  }
  return log;
}

describe("memory verification prod server env", () => {
  it("isolates DATA_DIR per role without relying on a new worker flag", () => {
    const baseline = resolveMemoryVerificationProdServerEnv({ role: "baseline" });
    const pr = resolveMemoryVerificationProdServerEnv({ role: "pr" });
    assert.notEqual(baseline.DATA_DIR, pr.DATA_DIR);
    assert.equal(baseline.PORT, "3200");
    assert.equal(pr.PORT, "3100");
    assert.equal(baseline.PLAYWRIGHT_PROD_SERVER, "1");
  });
});

describe("direct server.js production-mode recurrence", { concurrency: 1 }, () => {
  it("NODE_ENV=production, flag unset, paid key present: 0 translation POST, job frozen", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-verify-direct-"));
    const { jobId } = seedPendingTranslationJob(dataDir);
    const port = await listenFreePort();
    const logPath = path.join(dataDir, "server-boot.log");
    const logFd = fs.openSync(logPath, "w");
    const env = spawnEnv({
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      PLAYWRIGHT_PROD_SERVER: "1",
      CHEAPER_INFERENCE_API_KEY: process.env.CHEAPER_INFERENCE_API_KEY || "test-key-never-sent",
      DISABLE_PAYOUT_SCHEDULER: "1",
      DISABLE_FINANCE_SCHEDULER: "1",
      DISABLE_MAIN_RP_CACHE_TTL_AUDIT: "1",
      SESSION_SECRET: "local-memory-verification-secret-0123456789abcdef",
    });
    const child = spawn(TSX, [SERVER_JS], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    try {
      const log = await waitLog(
        logPath,
        (text) => text.includes("Ready on http://localhost:") && text.includes("derived cache worker disabled"),
        90_000
      );
      assert.match(log, /derived cache worker disabled/);
      assert.match(log, new RegExp(`Ready on http://localhost:${port}`));
      assert.doesNotMatch(log, /\[derivedCache\] wakeup scheduler started/);
      await new Promise((r) => setTimeout(r, 2500));
      const row = readJobRow(dataDir, jobId);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          try {
            process.kill(child.pid, "SIGTERM");
          } catch {
            /* gone */
          }
        }
        await once(child, "exit").catch(() => undefined);
      }
      const after = fs.readFileSync(logPath, "utf8");
      assert.doesNotMatch(after, /model: 'gpt-6-luna'/);
    }
  });
});

describe("memory verification launcher subprocess", { concurrency: 1 }, () => {
  it("stops the owned tsx child and frees its port; leaves 3000 untouched", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-verify-launcher-"));
    seedPendingTranslationJob(dataDir);
    const port = await listenFreePort();
    const port3000Before = await isPortListening(3000);
    const logPath = path.join(dataDir, "launcher.log");
    const logFd = fs.openSync(logPath, "w");
    const env = spawnEnv({
      ...resolveMemoryVerificationProdServerEnv({ role: "pr", port, dataDir }),
    });
    const launcher = spawn(TSX, [LAUNCHER, "pr", "--port", String(port), "--data-dir", dataDir], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    let ownedPid: number | null = null;
    try {
      const log = await waitLog(
        logPath,
        (text) => /owned child pid=\d+/.test(text) && text.includes("Ready on http://localhost:"),
        90_000
      );
      const pidMatch = log.match(/owned child pid=(\d+)/);
      assert.ok(pidMatch);
      ownedPid = Number(pidMatch[1]);
      assert.equal(isPidAlive(ownedPid), true);
      assert.equal(await isPortListening(port), true);
      assert.ok(launcher.pid);
      process.kill(launcher.pid, "SIGTERM");
      await once(launcher, "exit");
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && isPidAlive(ownedPid)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(isPidAlive(ownedPid), false, `owned child ${ownedPid} still alive after launcher SIGTERM`);
      assert.equal(await isPortListening(port), false);
      assert.equal(await isPortListening(3000), port3000Before);
    } finally {
      if (launcher.pid && isPidAlive(launcher.pid)) {
        try {
          process.kill(launcher.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      if (ownedPid && isPidAlive(ownedPid)) {
        try {
          process.kill(-ownedPid, "SIGKILL");
        } catch {
          try {
            process.kill(ownedPid, "SIGKILL");
          } catch {
            /* gone */
          }
        }
      }
    }
  });
});
