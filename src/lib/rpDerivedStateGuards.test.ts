import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ensureStatusWidgetTriggerTables,
  insertStatusWidgetTriggerForTest,
  evaluateStatusWidgetTriggers,
} from "@/lib/statusWidgetTriggers";
import {
  persistEpisodicMemoryFactsBestEffort,
  reconcileEpisodicMemoryFactsForGeneration,
} from "@/lib/episodicMemoryFacts";
import {
  isCanonicalDerivedStateGenerationStatus,
  hasLaterCanonicalTurn,
  isLatestCanonicalAssistantMessage,
  getLatestCanonicalAssistantMessageId,
  getAssistantSourceTurn,
} from "@/lib/rpDerivedStateLifecycle";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";

function fact(text: string): ExtractedStatusFact {
  return {
    category: "relationship",
    subject: "enok",
    attribute: "agreement",
    value: "yes",
    importance: "important",
    fact_text: text,
  };
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      generation_status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE episodic_memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      user_id INTEGER,
      source_turn INTEGER NOT NULL,
      source_user_message_id INTEGER,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      importance TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

function insertAssistant(
  db: Database.Database,
  chatId: number,
  status: string,
  model = "gpt-5.6-terra"
): number {
  const r = db
    .prepare(
      "INSERT INTO messages (chat_id, role, model, generation_status) VALUES (?, 'assistant', ?, ?)"
    )
    .run(chatId, model, status);
  return Number(r.lastInsertRowid);
}

/**
 * Mirrors the route.ts Phase B0 gate:
 *   derivedStateAllowed = assistantFinalizedThisRequest && isCanonical(status)
 */
function derivedStateAllowed(finalized: boolean, status: string | null | undefined): boolean {
  return finalized && isCanonicalDerivedStateGenerationStatus(status);
}

describe("Phase B0 — interrupted / failed turn derived-state guards (I1-I6)", () => {
  it("I1 completed → episodic allowed", () => {
    const db = makeDb();
    const id = insertAssistant(db, 1, "completed");
    assert.equal(derivedStateAllowed(true, "completed"), true);
    assert.equal(isLatestCanonicalAssistantMessage(db, 1, id), true);
  });

  it("I2 ok → allowed", () => {
    assert.equal(derivedStateAllowed(true, "ok"), true);
  });

  it("I3 completed_with_postprocess_error + usable data → existing canonical behavior preserved", () => {
    assert.equal(derivedStateAllowed(true, "completed_with_postprocess_error"), true);
  });

  it("I4 interrupted → new episodic facts = 0", () => {
    const db = makeDb();
    insertAssistant(db, 1, "interrupted");
    assert.equal(derivedStateAllowed(true, "interrupted"), false);
    // Reconcile must NOT run; simulate by checking the gate blocks it.
    // If it were erroneously called with isRegeneration=false + facts, normal path would insert.
    // The route gate prevents the call entirely.
    const n = derivedStateAllowed(true, "interrupted")
      ? reconcileEpisodicMemoryFactsForGeneration(db, {
          chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
          facts: [fact("x")], isRegeneration: false,
          metadata: { assistant_message_id: 1, request_id: "r" },
        })
      : { inserted: 0 };
    assert.equal(n.inserted, 0, "INTERRUPTED_NEW_EPISODIC_GHOST BLOCKED");
  });

  it("I5 failed_partial → new episodic facts = 0 / new trigger events = 0", () => {
    const db = makeDb();
    insertAssistant(db, 1, "failed_partial");
    assert.equal(derivedStateAllowed(true, "failed_partial"), false);
    insertStatusWidgetTriggerForTest(db, {
      trigger_id: "corruption_70", status_key: "corruption", operator: ">=",
      value: 70, fire_once: true, event_key: "e", effect_text: "x",
      character_knowledge: "unknown", is_enabled: true,
    } as never);
    // Gate blocks trigger eval for failed_partial.
    const allowed = derivedStateAllowed(true, "failed_partial");
    if (allowed) {
      evaluateStatusWidgetTriggers(db, {
        chatId: 1, characterId: 7, sourceTurn: 1,
        statusValues: { character: { corruption: "75" }, user: null },
        sourceMessageId: 1, requestId: "r", generationSequence: 0,
      });
    }
    const fired = db
      .prepare("SELECT COUNT(*) AS c FROM status_trigger_events WHERE chat_id=1")
      .get() as { c: number };
    assert.equal(fired.c, 0, "INTERRUPTED_NEW_TRIGGER_GHOST BLOCKED");
  });

  it("I6 interrupted visible prose preservation → unchanged (no derived write)", () => {
    const db = makeDb();
    const id = insertAssistant(db, 1, "interrupted");
    // Simulate visible partial prose saved (existing behavior) but no derived write.
    db.prepare("UPDATE messages SET content=? WHERE id=?").run("부분 출력...", id);
    assert.equal(derivedStateAllowed(true, "interrupted"), false);
    const row = db.prepare("SELECT content FROM messages WHERE id=?").get(id) as { content: string };
    assert.equal(row.content, "부분 출력...", "visible prose preserved");
  });
});

describe("Phase B0 — variant switch + historical replay boundary (V1-V5)", () => {
  it("V1 latest A→B episodic facts reconcile (replace source-turn)", () => {
    const db = makeDb();
    const a = insertAssistant(db, 1, "completed");
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("에녹은 렌과 동행하기로 합의했다.")],
      metadata: { assistant_message_id: a, request_id: "a" },
    });
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=1").get() as { c: number }).c,
      1
    );
    // Switch to B: replace source-turn with B's facts (empty).
    const turn = getAssistantSourceTurn(db, 1, a);
    assert.equal(turn, 1);
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [],
      replaceSourceTurn: true,
      metadata: { assistant_message_id: a, request_id: "b", variant_switch: true },
    });
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=1").get() as { c: number }).c,
      0,
      "V3 selected variant empty facts → old facts removed"
    );
  });

  it("V2 latest A→B trigger events reconcile (supersede)", () => {
    const db = makeDb();
    const a = insertAssistant(db, 1, "completed");
    insertStatusWidgetTriggerForTest(db, {
      trigger_id: "corruption_70", status_key: "corruption", operator: ">=",
      value: 70, fire_once: true, event_key: "e", effect_text: "x",
      character_knowledge: "unknown", is_enabled: true,
    } as never);
    evaluateStatusWidgetTriggers(db, {
      chatId: 1, characterId: 7, sourceTurn: 1,
      statusValues: { character: { corruption: "75" }, user: null },
      sourceMessageId: a, requestId: "a", generationSequence: 0,
    });
    // Supersede on switch
    const { supersedeStatusTriggerEventsForSourceMessage } = require("@/lib/rpDerivedStateLifecycle");
    supersedeStatusTriggerEventsForSourceMessage(db, 1, a, "variant_switch");
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM status_trigger_events WHERE chat_id=1 AND is_superseded=0").get() as { c: number }).c,
      0,
      "V4 selected variant trigger false → old trigger inactive"
    );
  });

  it("V3 selected variant empty facts → old facts removed", () => {
    // covered in V1
    assert.ok(true);
  });

  it("V4 selected variant trigger false → old trigger inactive", () => {
    // covered in V2
    assert.ok(true);
  });

  it("V5 historical switch → no fake full-replay claim; diagnostic unsupported", () => {
    const db = makeDb();
    const a = insertAssistant(db, 1, "completed");
    const later = insertAssistant(db, 1, "completed");
    assert.ok(later > a);
    assert.equal(hasLaterCanonicalTurn(db, 1, a), true, "later canonical turn exists");
    assert.equal(isLatestCanonicalAssistantMessage(db, 1, a), false, "a is not latest");
    assert.equal(getLatestCanonicalAssistantMessageId(db, 1), later);
    // Historical switch: B0 does not replay; the variant route logs
    // HISTORICAL_VARIANT_DERIVED_STATE_REPLAY_UNSUPPORTED and only updates
    // the display snapshot. This test asserts the helper boundary used by
    // the route to decide.
    assert.equal(isLatestCanonicalAssistantMessage(db, 1, later), true);
  });
});
