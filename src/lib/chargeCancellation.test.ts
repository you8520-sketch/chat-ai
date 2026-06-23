import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  backfillChargeBatchFromLog,
  ensurePointChargeBatchTable,
  isChargeWithinCancelWindow,
} from "@/lib/chargeCancellation";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensurePointChargeBatchTable(db);
  return db;
}

describe("isChargeWithinCancelWindow", () => {
  it("allows cancel within 168 hours of charge", () => {
    const db = setupDb();
    assert.equal(
      isChargeWithinCancelWindow("2026-06-11 00:41:00", {
        db,
        now: "2026-06-18 00:40:00",
      }),
      true
    );
    db.close();
  });

  it("rejects cancel after 168 hours from charge time", () => {
    const db = setupDb();
    assert.equal(
      isChargeWithinCancelWindow("2026-06-11 00:41:00", {
        db,
        now: "2026-06-18 00:42:00",
      }),
      false
    );
    db.close();
  });
});

describe("backfillChargeBatchFromLog", () => {
  it("recovers missing batch from charge log and transaction", () => {
    const db = setupDb();
    const userId = 1;
    const createdAt = "2026-06-11 00:41:00";

    const tx = db
      .prepare(
        `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at, created_at)
         VALUES (?, 'PAID', 5000, '2030-01-01', ?)`
      )
      .run(userId, createdAt);
    const log = db
      .prepare(`INSERT INTO point_logs (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)`)
      .run(userId, 5000, "포인트 충전 (₩5,000)", createdAt);

    const batch = backfillChargeBatchFromLog(userId, Number(log.lastInsertRowid), db);
    assert.ok(batch);
    assert.equal(batch!.paid_amount, 5000);
    assert.equal(batch!.paid_transaction_id, Number(tx.lastInsertRowid));
    assert.equal(batch!.created_at, createdAt);

    db.close();
  });
});
