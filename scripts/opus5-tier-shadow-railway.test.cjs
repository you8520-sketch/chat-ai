"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const SCRIPT = path.join(__dirname, "opus5-tier-shadow-railway.cjs");

function paidUsage(model, extra = {}) {
  return JSON.stringify({
    model,
    cost: 716,
    billingWaived: false,
    savedOutputChars: 3975,
    apiInputTokens: 62618,
    mainApiRawCostKrw: 392.2,
    cacheReadTokens: 0,
    cacheWriteTokens: 24000,
    statusWidgetExtract: { apiRawCostKrw: 2 },
    ...extra,
  });
}

test("Railway shadow script counts Claude Opus 5 only and prints aggregates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opus5-shadow-"));
  const dbPath = path.join(dir, "app.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      role TEXT,
      usage TEXT,
      model TEXT,
      is_refunded INTEGER
    );
  `);
  db.prepare("INSERT INTO messages (role, usage, model, is_refunded) VALUES (?, ?, ?, 0)").run(
    "assistant",
    paidUsage("claude-opus-5"),
    "claude-opus-5"
  );
  db.prepare("INSERT INTO messages (role, usage, model, is_refunded) VALUES (?, ?, ?, 0)").run(
    "assistant",
    paidUsage("anthropic/claude-opus-4.5"),
    "anthropic/claude-opus-4.5"
  );
  db.prepare("INSERT INTO messages (role, usage, model, is_refunded) VALUES (?, ?, ?, 0)").run(
    "user",
    paidUsage("claude-opus-5"),
    "claude-opus-5"
  );
  db.close();

  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, OPUS5_SHADOW_DB: dbPath },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.modelFilter, "claude-opus-5");
  assert.equal(report.availableSample, 1);
  assert.equal(report.dbWrite, false);
  assert.equal(report.llmCalls, 0);
  assert.equal(report.priceAutoChanged, false);
  assert.equal(report.verdict, "AVAILABLE_SAMPLE_ONLY");
  assert.equal(report.last20.turns, 1);
  assert.equal(report.last20.newRevenueP, 500);
  assert.ok(!JSON.stringify(report).includes("나는"));
  fs.rmSync(dir, { recursive: true, force: true });
});
