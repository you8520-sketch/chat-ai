import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  ensureStatusWidgetTriggerTables,
  evaluateStatusWidgetTriggers,
  insertStatusWidgetTriggerForTest,
  loadQueuedStatusTriggerEventsForPrompt,
  supersedeUnconsumedStatusTriggerEvents,
} from "@/lib/statusWidgetTriggers";
import { persistChatSettingsWithCreatorTriggerSupersede } from "./settingsPersist";

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      status_widget_mode TEXT NOT NULL DEFAULT 'character_only',
      status_widget_display_mode TEXT
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

describe("status widget settings atomic persist", () => {
  it("mode write + creator trigger supersede commit together", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO chats (id, status_widget_mode) VALUES (?, 'character_only')").run(1);
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "d_day_zero",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "deadline",
      effect_text: "기한 도달",
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 2,
      statusValues: { character: { d_day: "0" } },
    });
    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 1).length, 1);

    persistChatSettingsWithCreatorTriggerSupersede(db, {
      chatId: 1,
      sets: ["status_widget_mode=?"],
      vals: ["user_only"],
      writeMode: true,
      prevEffectiveMode: "character_only",
      nextEffectiveMode: "user_only",
    });

    const mode = db
      .prepare("SELECT status_widget_mode AS mode FROM chats WHERE id=1")
      .get() as { mode: string };
    assert.equal(mode.mode, "user_only");
    assert.equal(
      loadQueuedStatusTriggerEventsForPrompt(db, 1, 8, { needsCharacterValues: true }).length,
      0
    );
    const row = db
      .prepare("SELECT is_superseded FROM status_trigger_events WHERE chat_id=1")
      .get() as { is_superseded: number };
    assert.equal(row.is_superseded, 1);
  });

  it("supersede failure rolls back mode write and leaves queued events unchanged", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO chats (id, status_widget_mode) VALUES (?, 'character_only')").run(2);
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 2,
      trigger_id: "trust_high",
      status_key: "trust",
      operator: ">=",
      value: 10,
      fire_once: false,
      event_key: "trust_event",
      effect_text: "신뢰 상승",
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 2,
      sourceTurn: 1,
      statusValues: { character: { trust: "12" } },
    });
    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 2).length, 1);

    assert.throws(
      () =>
        persistChatSettingsWithCreatorTriggerSupersede(db, {
          chatId: 2,
          sets: ["status_widget_mode=?"],
          vals: ["off"],
          writeMode: true,
          prevEffectiveMode: "character_only",
          nextEffectiveMode: "off",
          supersedeHook: () => {
            throw new Error("forced supersede failure");
          },
        }),
      /forced supersede failure/
    );

    const mode = db
      .prepare("SELECT status_widget_mode AS mode FROM chats WHERE id=2")
      .get() as { mode: string };
    assert.equal(mode.mode, "character_only");
    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 2).length, 1);
    const row = db
      .prepare("SELECT is_superseded FROM status_trigger_events WHERE chat_id=2")
      .get() as { is_superseded: number };
    assert.equal(row.is_superseded, 0);
  });

  it("both→user_only atomic persist supersedes creator trigger queue", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO chats (id, status_widget_mode) VALUES (?, 'both')").run(3);
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 3,
      trigger_id: "affection_high",
      status_key: "affection",
      operator: ">=",
      value: 80,
      fire_once: true,
      event_key: "affection_event",
      effect_text: "애정 임계",
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 3,
      sourceTurn: 1,
      statusValues: { character: { affection: "90" } },
    });

    persistChatSettingsWithCreatorTriggerSupersede(db, {
      chatId: 3,
      sets: ["status_widget_mode=?"],
      vals: ["user_only"],
      writeMode: true,
      prevEffectiveMode: "both",
      nextEffectiveMode: "user_only",
    });

    const row = db
      .prepare("SELECT is_superseded FROM status_trigger_events WHERE chat_id=3")
      .get() as { is_superseded: number };
    assert.equal(row.is_superseded, 1);
  });
});
