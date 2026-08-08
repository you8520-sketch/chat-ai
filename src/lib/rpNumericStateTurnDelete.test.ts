/**
 * Phase B1-D1 — last-turn numeric delete / rollback tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import { ensureEpisodicMemoryFactsTable } from "@/lib/episodicMemoryFacts";
import { ensureStatusWidgetTriggerTables } from "@/lib/statusWidgetTriggers";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import {
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  commitNumericStateReplacementCore,
  ensureRpNumericStateTables,
  getNumericStateCurrent,
  getNumericStateEventById,
  NumericTurnDeleteChainNotReadyError,
  revertNumericStateForDeletedAssistantCore,
} from "@/lib/rpNumericState";
import { parseStoredStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 20,
  integer: true,
  maxIncreasePerTurn: 20,
  maxDecreasePerTurn: 20,
};

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      total_turns INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO characters (id, total_turns) VALUES (7, 10);

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER DEFAULT 0,
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'completed',
      status TEXT DEFAULT 'ok',
      is_refunded INTEGER DEFAULT 0,
      status_meta TEXT,
      deduction_slices TEXT,
      updated_at TEXT
    );

    CREATE TABLE bookmarks (
      message_id INTEGER PRIMARY KEY
    );
  `);
  ensureRpNumericStateTables(db);
  ensureStatusWidgetTriggerTables(db);
  ensureEpisodicMemoryFactsTable(db);
  return db;
}

function insertMsg(
  db: Database.Database,
  id: number,
  chatId: number,
  role: "user" | "assistant",
  content: string,
  statusJson = ""
): void {
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, status_widget_values_json, alternates, active_variant, generation_status)
     VALUES (?, ?, ?, ?, 'test', ?, '[]', 0, 'completed')`
  ).run(id, chatId, role, content, statusJson);
}

function countEvents(
  db: Database.Database,
  chatId: number,
  stateKey: string,
  assistantMessageId?: number
): number {
  if (assistantMessageId != null) {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM rp_numeric_state_events
           WHERE chat_id=? AND state_key=? AND assistant_message_id=?`
        )
        .get(chatId, stateKey, assistantMessageId) as { c: number }
    ).c;
  }
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM rp_numeric_state_events WHERE chat_id=? AND state_key=?`
      )
      .get(chatId, stateKey) as { c: number }
  ).c;
}

function commitTurn(
  db: Database.Database,
  opts: {
    chatId: number;
    stateKey: string;
    proposal: number | string;
    assistantMessageId: number;
    generationSequence?: number;
    requestId: string;
    sourceTurn: number;
  }
) {
  return commitNumericStateProposalCore(db, {
    chatId: opts.chatId,
    characterId: 7,
    stateKey: opts.stateKey,
    definition: def,
    proposal: opts.proposal,
    mutationId: `gen:${opts.assistantMessageId}:${opts.generationSequence ?? 0}:${opts.requestId}`,
    sourceKind: "extractor",
    assistantMessageId: opts.assistantMessageId,
    generationSequence: opts.generationSequence ?? 0,
    requestId: opts.requestId,
    sourceTurn: opts.sourceTurn,
  });
}

describe("Phase B1-D1 — last-turn numeric delete", () => {
  it("D1 normal T1→T2→T3 delete T3 restores 40", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 30,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u1");
    insertMsg(db, 2, 1, "assistant", "a1", JSON.stringify({ character: { affection: "35" } }));
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 35,
      assistantMessageId: 2,
      requestId: "t1",
      sourceTurn: 1,
    });
    insertMsg(db, 3, 1, "user", "u2");
    insertMsg(db, 4, 1, "assistant", "a2", JSON.stringify({ character: { affection: "40" } }));
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 40,
      assistantMessageId: 4,
      requestId: "t2",
      sourceTurn: 2,
    });
    insertMsg(db, 5, 1, "user", "u3");
    insertMsg(db, 6, 1, "assistant", "a3", JSON.stringify({ character: { affection: "44" } }));
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 6,
      requestId: "t3",
      sourceTurn: 3,
    });

    db.prepare(
      `INSERT INTO episodic_memory_facts
       (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 7, 1, 3, 'preference', 'user', 'x', 'y', 'important', 't3 fact', '{"assistant_message_id":6}')`
    ).run();
    db.prepare(
      `INSERT INTO status_trigger_events
       (chat_id, character_id, trigger_id, source_message_id, source_turn, event_key, effect_text, is_consumed)
       VALUES (1, 7, 'trig-t3', 6, 3, 'ek', 'fx', 0)`
    ).run();

    const result = executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 5,
      assistantMessageId: 6,
      revertNumeric: true,
    });
    assert.deepEqual(result.deletedIds, [5, 6]);

    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 40);
    assert.equal(cur.lastSourceMessageId, 4);
    assert.equal(countEvents(db, 1, "affection", 6), 0);
    assert.ok(countEvents(db, 1, "affection", 2) >= 1);
    assert.ok(countEvents(db, 1, "affection", 4) >= 1);

    const msgs = db
      .prepare(`SELECT id FROM messages WHERE chat_id=1 ORDER BY id`)
      .all() as Array<{ id: number }>;
    assert.deepEqual(
      msgs.map((m) => m.id),
      [1, 2, 3, 4]
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM episodic_memory_facts
             WHERE chat_id=1
               AND json_extract(metadata, '$.assistant_message_id') = 6`
          )
          .get() as { c: number }
      ).c,
      0
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events WHERE source_message_id=6`
          )
          .get() as { c: number }
      ).c,
      0
    );

    // Parity: remaining latest assistant status snapshot == numeric current
    const latestStatus = parseStoredStatusWidgetValuesJson(
      (
        db
          .prepare(`SELECT status_widget_values_json AS v FROM messages WHERE id=4`)
          .get() as { v: string }
      ).v
    );
    assert.equal(latestStatus?.character?.affection, "40");
    assert.equal(String(cur.numericValue), latestStatus?.character?.affection);
  });

  it("D2 regen chain A/B/C delete restores pre-turn 40; all variants gone", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    const a = commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 2,
      generationSequence: 0,
      requestId: "a",
      sourceTurn: 1,
    });
    const b = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 42,
      mutationId: "gen:2:1:b",
      sourceKind: "extractor",
      assistantMessageId: 2,
      generationSequence: 1,
      requestId: "b",
      sourceTurn: 1,
    });
    const c = commitNumericStateReplacementCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      proposal: 45,
      mutationId: "gen:2:2:c",
      sourceKind: "extractor",
      assistantMessageId: 2,
      generationSequence: 2,
      requestId: "c",
      sourceTurn: 1,
    });
    assert.equal(c.current.numericValue, 45);
    assert.equal(b.event?.beforeValue, 40);
    assert.equal(a.event?.beforeValue, 40);

    const predId = getNumericStateCurrent(db, 1, "affection")!.lastEventId!;
    // predecessor before delete = INITIALIZED
    const init = getNumericStateEventById(db, 1)!;
    assert.equal(init.outcome, "INITIALIZED");

    revertNumericStateForDeletedAssistantCore(db, {
      chatId: 1,
      assistantMessageId: 2,
    });
    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 40);
    assert.equal(cur.revision, 1);
    assert.equal(cur.lastSourceMessageId, null);
    assert.equal(cur.lastEventId, init.id);
    assert.equal(countEvents(db, 1, "affection", 2), 0);
    assert.ok(getNumericStateEventById(db, init.id));
    assert.notEqual(cur.lastEventId, predId);
  });

  it("D3 legacy bootstrap first numeric turn delete keeps INITIALIZED", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 35,
      mutationId: "bootstrap:1:affection:legacy_bootstrap",
      sourceKind: "legacy_bootstrap",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 38,
      assistantMessageId: 2,
      requestId: "t",
      sourceTurn: 1,
    });
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: true,
    });
    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 35);
    assert.equal(cur.lastSourceMessageId, null);
    const tip = getNumericStateEventById(db, cur.lastEventId!)!;
    assert.equal(tip.outcome, "INITIALIZED");
    assert.equal(tip.sourceKind, "legacy_bootstrap");
    assert.equal(countEvents(db, 1, "affection", 2), 0);
  });

  it("D4 definition initial delete restores initial", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 20,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 24,
      assistantMessageId: 2,
      requestId: "t",
      sourceTurn: 1,
    });
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: true,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 20);
  });

  it("D5 INVALID_HOLD event deleted; current stays 40", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    const hold = commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: "약 44",
      assistantMessageId: 2,
      requestId: "hold",
      sourceTurn: 1,
    });
    assert.equal(hold.kind, "INVALID_HOLD");
    assert.equal(hold.current.numericValue, 40);
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: true,
    });
    const cur = getNumericStateCurrent(db, 1, "affection")!;
    assert.equal(cur.numericValue, 40);
    assert.equal(countEvents(db, 1, "affection", 2), 0);
  });

  it("D5b NO_CHANGE event deleted; current stays", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    const nc = commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 40,
      assistantMessageId: 2,
      requestId: "nc",
      sourceTurn: 1,
    });
    assert.equal(nc.kind, "NO_CHANGE");
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: true,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 40);
    assert.equal(countEvents(db, 1, "affection", 2), 0);
  });

  it("D6 multi-field atomic rollback", () => {
    const db = makeDb();
    for (const [key, initial] of [
      ["affection", 40],
      ["trust", 30],
      ["corruption", 5],
    ] as const) {
      bootstrapNumericStateCurrentCore(db, {
        chatId: 1,
        stateKey: key,
        definition: def,
        baselineValue: initial,
        mutationId: `bootstrap:1:${key}:definition_initial`,
        sourceKind: "definition_initial",
      });
    }
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 2,
      requestId: "m",
      sourceTurn: 1,
    });
    commitTurn(db, {
      chatId: 1,
      stateKey: "trust",
      proposal: 33,
      assistantMessageId: 2,
      requestId: "m",
      sourceTurn: 1,
    });
    commitTurn(db, {
      chatId: 1,
      stateKey: "corruption",
      proposal: 10,
      assistantMessageId: 2,
      requestId: "m",
      sourceTurn: 1,
    });
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: true,
    });
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 40);
    assert.equal(getNumericStateCurrent(db, 1, "trust")?.numericValue, 30);
    assert.equal(getNumericStateCurrent(db, 1, "corruption")?.numericValue, 5);
  });

  it("D7 broken tip → chain_not_ready; nothing deleted", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 2,
      requestId: "t",
      sourceTurn: 1,
    });
    // Corrupt tip pointer away from deleted assistant
    db.prepare(
      `UPDATE rp_numeric_state_current SET last_source_message_id=999 WHERE chat_id=1 AND state_key='affection'`
    ).run();

    assert.throws(
      () =>
        executeLastTurnDeleteTransaction(db, {
          chatId: 1,
          characterId: 7,
          userMessageId: 1,
          assistantMessageId: 2,
          revertNumeric: true,
        }),
      (e: unknown) => e instanceof NumericTurnDeleteChainNotReadyError
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c,
      2
    );
    assert.equal(countEvents(db, 1, "affection", 2), 1);
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 44);
  });

  it("D8 forced failure after numeric restore rolls back numeric+messages", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 2,
      requestId: "t",
      sourceTurn: 1,
    });
    assert.throws(() =>
      executeLastTurnDeleteTransaction(db, {
        chatId: 1,
        characterId: 7,
        userMessageId: 1,
        assistantMessageId: 2,
        revertNumeric: true,
        __testThrowAfterNumericRestore: true,
      })
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 44);
    assert.equal(countEvents(db, 1, "affection", 2), 1);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c,
      2
    );
  });

  it("D9 forced failure after message delete rolls back numeric restore", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 2,
      requestId: "t",
      sourceTurn: 1,
    });
    assert.throws(() =>
      executeLastTurnDeleteTransaction(db, {
        chatId: 1,
        characterId: 7,
        userMessageId: 1,
        assistantMessageId: 2,
        revertNumeric: true,
        __testThrowAfterMessageDelete: true,
      })
    );
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 44);
    assert.equal(countEvents(db, 1, "affection", 2), 1);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c,
      2
    );
  });

  it("D10 nonnumeric path (revertNumeric=false) deletes messages only", () => {
    const db = makeDb();
    insertMsg(db, 1, 1, "user", "u");
    insertMsg(db, 2, 1, "assistant", "a");
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 1,
      assistantMessageId: 2,
      revertNumeric: false,
    });
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c,
      0
    );
  });

  it("D12 trigger cleanup failure rolls back numeric+messages+episodic+triggers+engagement", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      characterId: 7,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(db, 1, 1, "user", "u1");
    insertMsg(
      db,
      2,
      1,
      "assistant",
      "a1",
      JSON.stringify({ character: { affection: "40" } })
    );
    insertMsg(db, 3, 1, "user", "u2");
    insertMsg(
      db,
      4,
      1,
      "assistant",
      "a2",
      JSON.stringify({ character: { affection: "44" } })
    );
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 4,
      requestId: "t2",
      sourceTurn: 2,
    });

    db.prepare(
      `INSERT INTO episodic_memory_facts
       (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 7, 1, 2, 'preference', 'user', 'x', 'y', 'important', 't2 fact', '{"assistant_message_id":4}')`
    ).run();
    db.prepare(
      `INSERT INTO status_trigger_events
       (chat_id, character_id, trigger_id, source_message_id, source_turn, event_key, effect_text, is_consumed)
       VALUES (1, 7, 'trig-t2', 4, 2, 'ek', 'fx', 0)`
    ).run();

    const engagementBefore = (
      db.prepare(`SELECT total_turns AS t FROM characters WHERE id=7`).get() as {
        t: number;
      }
    ).t;
    const numericBefore = getNumericStateCurrent(db, 1, "affection")!.numericValue;
    const eventsBefore = countEvents(db, 1, "affection", 4);
    const triggerBefore = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM status_trigger_events WHERE source_message_id=4`
        )
        .get() as { c: number }
    ).c;
    const episodicBefore = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM episodic_memory_facts
           WHERE chat_id=1
             AND json_extract(metadata, '$.assistant_message_id') = 4`
        )
        .get() as { c: number }
    ).c;
    assert.equal(numericBefore, 44);
    assert.ok(eventsBefore >= 1);
    assert.equal(triggerBefore, 1);
    assert.equal(episodicBefore, 1);

    // Deterministic failure: abort DELETE of the target assistant's trigger row.
    db.exec(`
      CREATE TRIGGER fail_status_trigger_cleanup_d12
      BEFORE DELETE ON status_trigger_events
      WHEN OLD.source_message_id = 4
      BEGIN
        SELECT RAISE(ABORT, 'TEST_TRIGGER_CLEANUP_FORCE_FAIL');
      END;
    `);

    assert.throws(
      () =>
        executeLastTurnDeleteTransaction(db, {
          chatId: 1,
          characterId: 7,
          userMessageId: 3,
          assistantMessageId: 4,
          revertNumeric: true,
        }),
      (e: unknown) =>
        e instanceof Error &&
        /TEST_TRIGGER_CLEANUP_FORCE_FAIL/i.test(e.message)
    );

    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 44);
    assert.equal(countEvents(db, 1, "affection", 4), eventsBefore);
    assert.equal(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE chat_id=1`).get() as {
          c: number;
        }
      ).c,
      4
    );
    assert.ok(
      db.prepare(`SELECT id FROM messages WHERE id=3`).get(),
      "user message must remain"
    );
    assert.ok(
      db.prepare(`SELECT id FROM messages WHERE id=4`).get(),
      "assistant message must remain"
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM episodic_memory_facts
             WHERE chat_id=1
               AND json_extract(metadata, '$.assistant_message_id') = 4`
          )
          .get() as { c: number }
      ).c,
      1
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM status_trigger_events WHERE source_message_id=4`
          )
          .get() as { c: number }
      ).c,
      1
    );
    assert.equal(
      (
        db.prepare(`SELECT total_turns AS t FROM characters WHERE id=7`).get() as {
          t: number;
        }
      ).t,
      engagementBefore
    );
  });

  it("D11 nonnumeric field location stays on prior message snapshot (not rewritten)", () => {
    const db = makeDb();
    bootstrapNumericStateCurrentCore(db, {
      chatId: 1,
      stateKey: "affection",
      definition: def,
      baselineValue: 40,
      mutationId: "bootstrap:1:affection:definition_initial",
      sourceKind: "definition_initial",
    });
    insertMsg(
      db,
      1,
      1,
      "user",
      "u1"
    );
    insertMsg(
      db,
      2,
      1,
      "assistant",
      "a1",
      JSON.stringify({ character: { affection: "40", location: "A" } })
    );
    // no numeric event for T2 baseline — tip still INITIALIZED
    insertMsg(db, 3, 1, "user", "u2");
    insertMsg(
      db,
      4,
      1,
      "assistant",
      "a2",
      JSON.stringify({ character: { affection: "44", location: "B" } })
    );
    commitTurn(db, {
      chatId: 1,
      stateKey: "affection",
      proposal: 44,
      assistantMessageId: 4,
      requestId: "t3",
      sourceTurn: 2,
    });
    executeLastTurnDeleteTransaction(db, {
      chatId: 1,
      characterId: 7,
      userMessageId: 3,
      assistantMessageId: 4,
      revertNumeric: true,
    });
    const t2 = parseStoredStatusWidgetValuesJson(
      (
        db
          .prepare(`SELECT status_widget_values_json AS v FROM messages WHERE id=2`)
          .get() as { v: string }
      ).v
    );
    assert.equal(t2?.character?.location, "A");
    assert.equal(t2?.character?.affection, "40");
    assert.equal(getNumericStateCurrent(db, 1, "affection")?.numericValue, 40);
  });
});
