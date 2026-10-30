import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { projectFinanceAnomalyIncidents } from "./adminOpsInbox";
import {
  notifyAdminsFinanceAnomaly,
  type FinanceAnomalyIncident,
} from "./userNotifications";

const FETCH_FAILURE: FinanceAnomalyIncident = {
  code: "FORWARD_RECON_FETCH_FAILURE",
  severity: "warning",
  sourceRef: "forward_audit:2026-10-05T03:00:00.175Z:incomplete",
};

const UNMATCHED: FinanceAnomalyIncident = {
  code: "FORWARD_UNMATCHED_REMOTE_SPEND",
  severity: "warning",
  sourceRef: "forward_unmatched:2026-10-05T03:00:00.175Z:1",
};

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE web_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL
    );
    CREATE TABLE web_push_user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      UNIQUE(user_id, event_key)
    );
    CREATE TABLE web_push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      UNIQUE(subscription_id, event_key)
    );
  `);
  db.prepare("INSERT INTO users (id, email, is_admin) VALUES (1, 'admin@example.com', 1)").run();
  return db;
}

function notify(
  db: Database.Database,
  slotKey: string,
  incidents: readonly FinanceAnomalyIncident[]
): number[] {
  const criticalCount = incidents.filter((row) => row.severity === "critical").length;
  const warningCount = incidents.filter((row) => row.severity === "warning").length;
  return notifyAdminsFinanceAnomaly(db, {
    slotKey,
    criticalCount,
    warningCount,
    anomalyTitles: incidents.map((row) => row.code),
    incidents,
  });
}

function notificationCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM user_notifications").get() as { c: number }).c;
}

describe("finance anomaly incident notifications", () => {
  it("sends the same unresolved warning once across three days", () => {
    const db = makeDb();
    try {
      assert.deepEqual(notify(db, "2026-10-28", [FETCH_FAILURE]), [1]);
      assert.deepEqual(notify(db, "2026-10-29", [FETCH_FAILURE]), []);
      assert.deepEqual(notify(db, "2026-10-30", [FETCH_FAILURE]), []);
      assert.equal(notificationCount(db), 1);

      const openReport = projectFinanceAnomalyIncidents(
        {
          generatedAt: "2026-10-30T03:00:00.000Z",
          monthKey: "2026-10",
          status: "WARNING",
          criticalCount: 0,
          warningCount: 1,
          anomalies: [
            {
              id: "provider-reconciliation:forward-fetch-failure",
              code: "FORWARD_RECON_FETCH_FAILURE",
              severity: "warning",
              title: "Forward usage audit fetch failed",
              summary: "still open on the finance report",
              sourceRef: FETCH_FAILURE.sourceRef,
              href: "/admin/finance",
              modelId: null,
            },
          ],
        },
        new Date("2026-10-30T03:00:00.000Z")
      );
      assert.equal(openReport.length, 1);
      assert.equal(openReport[0]!.state, "FORWARD_RECON_FETCH_FAILURE");
    } finally {
      db.close();
    }
  });

  it("sends a new warning, a severity increase, and a relapse after recovery", () => {
    const db = makeDb();
    try {
      assert.deepEqual(notify(db, "2026-10-28", [FETCH_FAILURE]), [1]);
      db.prepare("UPDATE user_notifications SET read_at = '2026-10-28 12:05:00'").run();

      assert.deepEqual(notify(db, "2026-10-29", [FETCH_FAILURE, UNMATCHED]), [1]);
      assert.equal(notificationCount(db), 2);

      const critical = { ...FETCH_FAILURE, severity: "critical" as const };
      assert.deepEqual(notify(db, "2026-10-30", [critical]), [1]);
      assert.equal(notificationCount(db), 3);

      assert.deepEqual(
        notifyAdminsFinanceAnomaly(db, {
          slotKey: "2026-10-31",
          criticalCount: 0,
          warningCount: 0,
          anomalyTitles: [],
          incidents: [],
        }),
        []
      );
      assert.equal(notificationCount(db), 3);
      const read = db.prepare("SELECT read_at FROM user_notifications WHERE id = 1").get() as {
        read_at: string;
      };
      assert.equal(read.read_at, "2026-10-28 12:05:00");

      assert.deepEqual(notify(db, "2026-11-01", [FETCH_FAILURE]), [1]);
      assert.deepEqual(notify(db, "2026-11-01", [FETCH_FAILURE]), []);
      assert.equal(notificationCount(db), 4);
      const stillRead = db.prepare("SELECT read_at FROM user_notifications WHERE id = 1").get() as {
        read_at: string;
      };
      assert.equal(stillRead.read_at, "2026-10-28 12:05:00");
    } finally {
      db.close();
    }
  });

  it("does not resend A when only B is resolved, and sends A again after it clears", () => {
    const db = makeDb();
    try {
      assert.deepEqual(notify(db, "2026-10-28", [FETCH_FAILURE]), [1]);
      assert.deepEqual(notify(db, "2026-10-29", [FETCH_FAILURE, UNMATCHED]), [1]);
      assert.deepEqual(notify(db, "2026-10-30", [UNMATCHED, FETCH_FAILURE]), []);
      assert.deepEqual(notify(db, "2026-10-31", [FETCH_FAILURE]), []);
      assert.deepEqual(
        notifyAdminsFinanceAnomaly(db, {
          slotKey: "2026-11-01",
          criticalCount: 0,
          warningCount: 0,
          anomalyTitles: [],
          incidents: [],
        }),
        []
      );
      assert.deepEqual(notify(db, "2026-11-02", [FETCH_FAILURE]), [1]);
      assert.equal(notificationCount(db), 3);
    } finally {
      db.close();
    }
  });

  it("sends again when the same unmatched count has a new spend witness", () => {
    const db = makeDb();
    try {
      const low = { ...UNMATCHED, evidence: "a".repeat(64) };
      const high = { ...UNMATCHED, evidence: "b".repeat(64) };
      assert.deepEqual(notify(db, "2026-10-28", [low]), [1]);
      assert.deepEqual(notify(db, "2026-10-29", [low]), []);
      assert.deepEqual(notify(db, "2026-10-30", [high]), [1]);
      assert.equal(notificationCount(db), 2);
    } finally {
      db.close();
    }
  });

  it("binds the first witness of a legacy open episode without sending it again", () => {
    const db = makeDb();
    try {
      db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
        "admin_finance_anomaly_episode",
        JSON.stringify({
          open: true,
          fingerprint: `${UNMATCHED.code}|${UNMATCHED.severity}|${UNMATCHED.sourceRef}`,
          refId: 7,
        })
      );
      db.prepare(
        "INSERT INTO user_notifications (user_id, type, ref_id, title, body, read_at) VALUES (1, 'admin_finance_anomaly', 7, 'old', 'old', '2026-10-28 12:05:00')"
      ).run();
      const witnessed = { ...UNMATCHED, evidence: "c".repeat(64) };
      assert.deepEqual(notify(db, "2026-10-29", [witnessed]), []);
      assert.equal(notificationCount(db), 1);
      assert.deepEqual(notify(db, "2026-10-30", [{ ...UNMATCHED, evidence: "d".repeat(64) }]), [1]);
      const kept = db.prepare("SELECT read_at FROM user_notifications WHERE ref_id = 7").get() as {
        read_at: string;
      };
      assert.equal(kept.read_at, "2026-10-28 12:05:00");
      assert.equal(notificationCount(db), 2);
    } finally {
      db.close();
    }
  });

  it("does not duplicate an open incident for an admin who already has it", () => {
    const db = makeDb();
    try {
      assert.deepEqual(notify(db, "2026-10-28", [FETCH_FAILURE]), [1]);
      db.prepare("INSERT INTO users (id, email, is_admin) VALUES (2, 'admin2@example.com', 1)").run();
      assert.deepEqual(notify(db, "2026-10-29", [FETCH_FAILURE]), [2]);
      assert.deepEqual(notify(db, "2026-10-29", [FETCH_FAILURE]), []);
      assert.equal(notificationCount(db), 2);
    } finally {
      db.close();
    }
  });
});
