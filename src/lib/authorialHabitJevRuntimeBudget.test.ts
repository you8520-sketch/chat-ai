import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY,
  AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS,
  tryReserveAuthorialHabitJevRuntimeCall,
} from "@/lib/authorialHabitJevRuntimeBudget";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

describe("authorial habit runtime JEV budget", () => {
  it("uses a durable atomic counter and refuses calls after the hard cap", () => {
    const db = makeDb();
    try {
      const first = tryReserveAuthorialHabitJevRuntimeCall({ db, limit: 2 });
      const second = tryReserveAuthorialHabitJevRuntimeCall({ db, limit: 2 });
      const third = tryReserveAuthorialHabitJevRuntimeCall({ db, limit: 2 });

      assert.deepEqual(first, {
        reserved: true,
        used: 1,
        limit: 2,
        reason: "reserved",
      });
      assert.deepEqual(second, {
        reserved: true,
        used: 2,
        limit: 2,
        reason: "reserved",
      });
      assert.deepEqual(third, {
        reserved: false,
        used: 2,
        limit: 2,
        reason: "budget_exhausted",
      });

      const row = db
        .prepare("SELECT value FROM app_meta WHERE key=?")
        .get(AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY) as { value: string };
      assert.equal(row.value, "2");
    } finally {
      db.close();
    }
  });

  it("fails closed on malformed persisted budget state", () => {
    const db = makeDb();
    try {
      db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)")
        .run(AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY, "not-a-number");

      const result = tryReserveAuthorialHabitJevRuntimeCall({ db, limit: 2 });
      assert.equal(result.reserved, false);
      assert.equal(result.used, null);
      assert.equal(result.reason, "budget_state_invalid");

      const row = db
        .prepare("SELECT value FROM app_meta WHERE key=?")
        .get(AUTHORIAL_HABIT_JEV_RUNTIME_BUDGET_KEY) as { value: string };
      assert.equal(row.value, "not-a-number");
    } finally {
      db.close();
    }
  });

  it("ships the approved runtime limit as exactly 50,000 attempts", () => {
    assert.equal(AUTHORIAL_HABIT_JEV_RUNTIME_MAX_CALLS, 50_000);
  });
});
