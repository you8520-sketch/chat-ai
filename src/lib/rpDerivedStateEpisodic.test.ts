import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  persistEpisodicMemoryFactsBestEffort,
  reconcileEpisodicMemoryFactsForGeneration,
  deleteEpisodicMemoryFactsByAssistantMessageIds,
} from "@/lib/episodicMemoryFacts";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";

function fact(text: string, subject = "enok", attribute = "agreement"): ExtractedStatusFact {
  return {
    category: "relationship",
    subject,
    attribute,
    value: "yes",
    importance: "important",
    fact_text: text,
  };
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
  return db;
}

function countFacts(db: Database.Database, chatId: number, sourceTurn: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE chat_id=? AND source_turn=?")
    .get(chatId, sourceTurn) as { c: number };
  return row.c;
}

describe("Phase B0 — episodic reconciliation (E1-E8)", () => {
  it("E1 normal facts insert", () => {
    const db = makeDb();
    const n = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("둘은 동행하기로 합의했다.")],
      isRegeneration: false,
      metadata: { assistant_message_id: 10, request_id: "r1" },
    });
    assert.equal(n.inserted, 1);
    assert.equal(countFacts(db, 1, 1), 1);
  });

  it("E2 normal empty facts noop (no delete)", () => {
    const db = makeDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 1,
      facts: [fact("이전에 중요한 사건이 있었다.")],
      metadata: { assistant_message_id: 10, request_id: "r1" },
    });
    assert.equal(countFacts(db, 1, 1), 1);
    const n = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 2,
      facts: [],
      isRegeneration: false,
      metadata: { assistant_message_id: 11, request_id: "r2" },
    });
    assert.equal(n.inserted, 0);
    assert.equal(n.replaced, false);
    assert.equal(countFacts(db, 1, 1), 1, "prior turn facts untouched");
  });

  it("E3 regen A=[fact1] → B=[fact2] final = fact2 only", () => {
    const db = makeDb();
    reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("에녹은 렌과 동행하기로 합의했다.")],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "a" },
    });
    assert.equal(countFacts(db, 1, 5), 1);
    const n = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("에녹은 렌의 동행을 거절했다.")],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "b" },
    });
    assert.equal(n.replaced, true);
    assert.equal(countFacts(db, 1, 5), 1);
    const txt = db
      .prepare("SELECT fact_text FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=5")
      .get() as { fact_text: string };
    assert.equal(txt.fact_text, "에녹은 렌의 동행을 거절했다.");
  });

  it("E4 regen A=[fact1] → B=[] final = none", () => {
    const db = makeDb();
    reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("에녹은 렌과 동행하기로 합의했다.")],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "a" },
    });
    assert.equal(countFacts(db, 1, 5), 1);
    const n = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "b" },
    });
    assert.equal(n.replaced, true);
    assert.equal(n.inserted, 0);
    assert.equal(countFacts(db, 1, 5), 0, "REGEN_EMPTY_FACT_STALE_MEMORY_BUG FIXED");
  });

  it("E5 duplicate finalize (same request_id) no extra delete/insert", () => {
    const db = makeDb();
    reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("에녹은 렌과 동행하기로 합의했다.")],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "a" },
    });
    assert.equal(countFacts(db, 1, 5), 1);
    // Replay same request_id → idempotent no-op (no delete, no insert)
    const n = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("다른 중요한 사건이 발생했다.")],
      isRegeneration: true,
      metadata: { assistant_message_id: 50, request_id: "a" },
    });
    assert.equal(n.inserted, 0);
    const txt = db
      .prepare("SELECT fact_text FROM episodic_memory_facts WHERE chat_id=1 AND source_turn=5")
      .get() as { fact_text: string };
    assert.equal(txt.fact_text, "에녹은 렌과 동행하기로 합의했다.", "original fact preserved on idempotent replay");
  });

  it("E6 material prose edit → DB facts deleted + embedded extracted_facts cleared", () => {
    const db = makeDb();
    persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1, characterId: 7, userId: 4, sourceTurn: 5,
      facts: [fact("에녹은 렌과 동행하기로 합의했다.")],
      metadata: { assistant_message_id: 50, request_id: "a" },
    });
    assert.equal(countFacts(db, 1, 5), 1);
    const deleted = deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [50]);
    assert.equal(deleted, 1);
    assert.equal(countFacts(db, 1, 5), 0);
  });

  it("E7 formatting-only prose edit → facts preserved (material detection)", () => {
    const { isMaterialProseEdit } = require("@/lib/canonicalProse") as {
      isMaterialProseEdit: (a: string, b: string) => boolean;
    };
    const before = "에녹은 렌의 손을 잡았다.\n\n그는 대답하지 않았다.";
    const after = "에녹은 렌의 손을 잡았다.  \r\n\r\n  그는 대답하지 않았다.";
    assert.equal(isMaterialProseEdit(before, after), false, "whitespace-only = not material");
    const material = "에녹은 렌의 손을 뿌리쳤다.\n\n그는 거절했다.";
    assert.equal(isMaterialProseEdit(before, material), true);
  });

  it("E8 status-only edit → facts preserved (material detection false)", () => {
    const { isMaterialProseEdit } = require("@/lib/canonicalProse") as {
      isMaterialProseEdit: (a: string, b: string) => boolean;
    };
    assert.equal(isMaterialProseEdit("동일 본문", "동일 본문"), false);
  });
});
