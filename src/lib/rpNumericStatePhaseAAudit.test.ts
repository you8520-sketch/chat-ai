/**
 * Phase A audit-only test: confirms REGEN_EMPTY_FACT_STALE_MEMORY_BUG at the library
 * boundary. This test does NOT change production behavior — it documents the
 * existing route-layer gap (route.ts:4595 gates persist on array length).
 *
 * The library itself (persistEpisodicMemoryFactsBestEffort) correctly deletes
 * on replaceSourceTurn even when facts are empty. The bug is that the route
 * never calls it when extractedFactsForPersistence.length === 0.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { persistEpisodicMemoryFactsBestEffort } from "@/lib/episodicMemoryFacts";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";

function makeFact(text: string): ExtractedStatusFact {
  return {
    category: "relationship",
    subject: "enok",
    attribute: "agreement",
    value: "travel_together",
    importance: "important",
    fact_text: text,
  };
}

describe("Phase A audit: regen empty-fact replacement (library boundary)", () => {
  it("library deletes prior facts on replaceSourceTurn even when new facts are empty", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE episodic_memory_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        character_id INTEGER,
        user_id INTEGER,
        source_turn INTEGER NOT NULL,
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

    // Variant A: persist fact1 for turn 10
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 7,
      userId: 4,
      sourceTurn: 10,
      facts: [makeFact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 100, request_id: "req-a" },
    });

    const afterA = db
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=10")
      .get() as { c: number };
    assert.equal(afterA.c, 1, "variant A should persist 1 fact");

    // Variant B (regen): library called with replaceSourceTurn + empty facts
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 7,
      userId: 4,
      sourceTurn: 10,
      facts: [],
      replaceSourceTurn: true,
      metadata: { assistant_message_id: 101, request_id: "req-b", regenerated: true },
    });

    const afterB = db
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=10")
      .get() as { c: number };

    // Library behavior is correct: replace deletes prior facts, empty insert = 0 rows.
    assert.equal(inserted, 0, "empty facts insert 0 rows");
    assert.equal(afterB.c, 0, "prior fact1 must be removed by replaceSourceTurn DELETE");
  });

  it("documents the route-layer gap: empty facts WITHOUT replaceSourceTurn leaves prior facts", () => {
    // This models the NON-regen case (correct to leave prior facts) AND
    // documents that if the route does NOT call persist at all (the actual bug),
    // prior facts remain. The library cannot self-heal a skipped call.
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE episodic_memory_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        character_id INTEGER,
        user_id INTEGER,
        source_turn INTEGER NOT NULL,
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

    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      characterId: 7,
      userId: 4,
      sourceTurn: 10,
      facts: [makeFact("둘은 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 100, request_id: "req-a" },
    });

    // Simulate the route bug: regen produces empty facts → route skips persist entirely.
    // (No persist call happens.) Prior fact remains.
    const after = db
      .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=10")
      .get() as { c: number };
    assert.equal(
      after.c,
      1,
      "REGEN_EMPTY_FACT_STALE_MEMORY_BUG: if route skips persist on empty facts, stale fact1 remains"
    );
  });
});
