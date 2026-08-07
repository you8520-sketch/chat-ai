import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ensureStatusWidgetTriggerTables,
  insertStatusWidgetTriggerForTest,
  evaluateStatusWidgetTriggers,
  loadQueuedStatusTriggerEventsForPrompt,
  type StatusWidgetTriggerDefinition,
} from "@/lib/statusWidgetTriggers";
import {
  supersedeStatusTriggerEventsForSourceMessage,
  deleteStatusTriggerEventsForSourceMessage,
  isCanonicalDerivedStateGenerationStatus,
} from "@/lib/rpDerivedStateLifecycle";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function trigger(over: Partial<StatusWidgetTriggerDefinition>): StatusWidgetTriggerDefinition {
  return {
    trigger_id: over.trigger_id ?? "corruption_70",
    status_key: over.status_key ?? "corruption",
    operator: over.operator ?? ">=",
    value: over.value ?? 70,
    fire_once: over.fire_once ?? true,
    event_key: over.event_key ?? "corruption_event",
    effect_text: over.effect_text ?? "환각 이벤트",
    character_knowledge: over.character_knowledge ?? "unknown",
    is_enabled: over.is_enabled ?? true,
  } as StatusWidgetTriggerDefinition;
}

function fireCount(db: Database.Database, chatId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM status_trigger_events WHERE chat_id=?")
    .get(chatId) as { c: number };
  return row.c;
}

function activeQueued(db: Database.Database, chatId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM status_trigger_events WHERE chat_id=? AND is_consumed=0 AND is_superseded=0"
    )
    .get(chatId) as { c: number };
  return row.c;
}

const status = (corruption: number) => ({
  character: { corruption: String(corruption) },
  user: null,
});

describe("Phase B0 — trigger supersession (T1-T9)", () => {
  it("T1 normal fire", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: status(75), sourceMessageId: 100, requestId: "r1", generationSequence: 0,
    });
    assert.equal(fireCount(db, 1), 1);
    assert.equal(activeQueued(db, 1), 1);
  });

  it("T2 regen A=true → B=false: A event superseded, no queued active event", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeQueued(db, 1), 1);
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "regeneration");
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(40), sourceMessageId: 50, requestId: "b", generationSequence: 1,
    });
    assert.equal(activeQueued(db, 1), 0, "REGEN_STALE_TRIGGER_EVENT_RISK FIXED");
  });

  it("T3 regen A=false → B=true: new B event active", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(40), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeQueued(db, 1), 0);
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "regeneration");
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "b", generationSequence: 1,
    });
    assert.equal(activeQueued(db, 1), 1);
  });

  it("T4 fire_once: A=true superseded by regen, B=true → B can fire", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7, fire_once: true }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(fireCount(db, 1), 1);
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "regeneration");
    // Without supersession, alreadyFired would block this. After supersession it must fire.
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "b", generationSequence: 1,
    });
    assert.equal(fireCount(db, 1), 2, "fire_once not blocked by rejected variant");
    assert.equal(activeQueued(db, 1), 1);
  });

  it("T5 same-turn duplicate → active duplicate 0", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7, fire_once: false }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a2", generationSequence: 1,
    });
    assert.equal(fireCount(db, 1), 1, "same-turn alreadyQueued prevents duplicate");
  });

  it("T6 last-turn delete → source trigger events gone", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(fireCount(db, 1), 1);
    const deleted = deleteStatusTriggerEventsForSourceMessage(db, 1, 50);
    assert.equal(deleted, 1);
    assert.equal(fireCount(db, 1), 0);
    assert.equal(activeQueued(db, 1), 0, "LAST_TURN_DELETE_STALE_TRIGGER FIXED");
  });

  it("T7 latest manual status edit true→false → prior event superseded", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7, fire_once: false }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeQueued(db, 1), 1);
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "manual_status_edit");
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(40), sourceMessageId: 50, requestId: null, generationSequence: null,
    });
    assert.equal(activeQueued(db, 1), 0);
  });

  it("T8 latest manual status edit false→true → new event active", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7, fire_once: false }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(40), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    assert.equal(activeQueued(db, 1), 0);
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "manual_status_edit");
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: null, generationSequence: null,
    });
    assert.equal(activeQueued(db, 1), 1);
  });

  it("T9 superseded queued event → not loaded into next prompt", () => {
    const db = makeDb();
    insertStatusWidgetTriggerForTest(db, trigger({ character_id: 7 }));
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 5,
      statusValues: status(75), sourceMessageId: 50, requestId: "a", generationSequence: 0,
    });
    supersedeStatusTriggerEventsForSourceMessage(db, 1, 50, "regeneration");
    const loaded = loadQueuedStatusTriggerEventsForPrompt(db, 1, 8);
    assert.equal(loaded.length, 0, "superseded event not loaded");
  });

  it("isCanonicalDerivedStateGenerationStatus helper", () => {
    assert.equal(isCanonicalDerivedStateGenerationStatus("completed"), true);
    assert.equal(isCanonicalDerivedStateGenerationStatus("ok"), true);
    assert.equal(isCanonicalDerivedStateGenerationStatus("completed_with_postprocess_error"), true);
    assert.equal(isCanonicalDerivedStateGenerationStatus("interrupted"), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus("failed_partial"), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus("failed"), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus("generating"), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus("submitted"), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus(null), false);
    assert.equal(isCanonicalDerivedStateGenerationStatus(undefined), false);
  });
});
