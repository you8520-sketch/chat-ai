import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import Database from "better-sqlite3";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMemoryVerificationProdServerEnv } from "./lib/memoryVerificationProdServerEnv";

const WORLD_CONTENT = "검증 서버 번역 큐 고정. ".repeat(6);

function seedPendingTranslationJob(dataDir: string): { jobId: number; attempts: number } {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "app.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, pw_hash TEXT, points INTEGER DEFAULT 0, is_adult INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER, name TEXT, summary TEXT, content TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS derived_cache_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_kind TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      derivation_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
  const fp = Buffer.from(WORLD_CONTENT).toString("hex").slice(0, 64);
  const insert = db.prepare(
    `INSERT INTO derived_cache_jobs (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, attempts)
     VALUES ('world_translate', 'world', ?, ?, 'v1', 'pending', 0)`
  );
  const info = insert.run(worldId, fp);
  const jobId = Number(info.lastInsertRowid);
  db.close();
  return { jobId, attempts: 0 };
}

function readJobRow(dataDir: string, jobId: number): { status: string; attempts: number } {
  const db = new Database(path.join(dataDir, "app.db"), { readonly: true });
  const row = db
    .prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE id=?`)
    .get(jobId) as { status: string; attempts: number };
  db.close();
  return row;
}

describe("memory verification prod server env", () => {
  it("sets DISABLE_DERIVED_CACHE_WORKER=1 and isolates DATA_DIR per role", () => {
    const baseline = resolveMemoryVerificationProdServerEnv({ role: "baseline" });
    const pr = resolveMemoryVerificationProdServerEnv({ role: "pr" });
    assert.equal(baseline.DISABLE_DERIVED_CACHE_WORKER, "1");
    assert.equal(pr.DISABLE_DERIVED_CACHE_WORKER, "1");
    assert.equal(baseline.PLAYWRIGHT_PROD_SERVER, "1");
    assert.notEqual(baseline.DATA_DIR, pr.DATA_DIR);
    assert.equal(baseline.PORT, "3200");
    assert.equal(pr.PORT, "3100");
  });

});

describe("memory verification prod server subprocess", () => {
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const serverJs = path.join(process.cwd(), "server.js");

  it("boots with derived cache worker disabled after .env load (log evidence)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-verify-boot-"));
    const { jobId } = seedPendingTranslationJob(dataDir);
    const port = 3199;
    const logPath = path.join(dataDir, "server-boot.log");
    const logFd = fs.openSync(logPath, "w");
    const env = resolveMemoryVerificationProdServerEnv({
      role: "pr",
      port,
      dataDir,
    });
    const child = spawn(tsxBin, [serverJs], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    try {
      const deadline = Date.now() + 90_000;
      let log = "";
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        log = fs.readFileSync(logPath, "utf8");
        if (log.includes("Ready on http://localhost:") && log.includes("derived cache worker disabled")) {
          break;
        }
      }
      assert.match(log, /derived cache worker disabled/);
      assert.match(log, /Ready on http:\/\/localhost:3199/);
      assert.doesNotMatch(log, /\[derivedCache\] wakeup scheduler started/);
      await new Promise((r) => setTimeout(r, 2500));
      const row = readJobRow(dataDir, jobId);
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
    } finally {
      if (child.pid) {
        process.kill(-child.pid, "SIGTERM");
        await once(child, "exit").catch(() => undefined);
      }
      const after = fs.readFileSync(logPath, "utf8");
      assert.doesNotMatch(after, /model: 'gpt-6-luna'/);
    }
  });
});
