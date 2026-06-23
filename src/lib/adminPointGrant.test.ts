import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  ADMIN_FREE_POINT_GRANT_REASON_PREFIX,
  AdminPointGrantError,
  buildAdminFreePointGrantReason,
  grantFreePointsByAdmin,
} from "@/lib/adminPointGrant";
import { isPointFreeCreditHistoryLog } from "@/lib/pointUsageLog";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      nickname TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      actor_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
    INSERT INTO users (id, nickname, points) VALUES (1, 'admin', 0), (2, 'target', 0);
  `);
  return db;
}

describe("buildAdminFreePointGrantReason", () => {
  it("uses default prefix without note", () => {
    assert.equal(buildAdminFreePointGrantReason(), ADMIN_FREE_POINT_GRANT_REASON_PREFIX);
  });

  it("appends note when provided", () => {
    assert.equal(
      buildAdminFreePointGrantReason("CS 보상"),
      `${ADMIN_FREE_POINT_GRANT_REASON_PREFIX} — CS 보상`
    );
  });
});

describe("grantFreePointsByAdmin", () => {
  it("credits FREE points and notifies recipient", () => {
    const db = setupDb();
    const result = grantFreePointsByAdmin(db, 1, {
      recipientNickname: "target",
      amount: 500,
      note: "테스트 지급",
    });

    assert.equal(result.recipientId, 2);
    assert.equal(result.amount, 500);
    assert.equal(result.recipientBalance.free, 500);

    const log = db
      .prepare("SELECT reason, delta FROM point_logs WHERE user_id = 2")
      .get() as { reason: string; delta: number };
    assert.equal(log.delta, 500);
    assert.equal(log.reason, `${ADMIN_FREE_POINT_GRANT_REASON_PREFIX} — 테스트 지급`);
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 500, reason: `${ADMIN_FREE_POINT_GRANT_REASON_PREFIX} — 테스트 지급` }),
      true
    );

    const notification = db
      .prepare("SELECT type, body FROM user_notifications WHERE user_id = 2")
      .get() as { type: string; body: string };
    assert.equal(notification.type, "admin_point_grant");
    assert.match(notification.body, /500P/);

    db.close();
  });

  it("throws when recipient is missing", () => {
    const db = setupDb();
    assert.throws(
      () =>
        grantFreePointsByAdmin(db, 1, {
          recipientNickname: "missing-user",
          amount: 100,
        }),
      (err: unknown) =>
        err instanceof AdminPointGrantError && err.code === "RECIPIENT_NOT_FOUND"
    );
    db.close();
  });
});
