import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";

import { EMPTY_MEMORY_META } from "@/lib/chatMemory";
import { ensureMemoryResetBoundaryColumns } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { reconcileEpisodicMemoryFactsForGeneration } from "@/lib/episodicMemoryFacts";
import {
  countMemoryEligibleCompletedTurnsUpToMessageId,
  remapForkResetBoundary,
} from "./memory-fork-snapshot";
import {
  countMemoryEligibleCompletedTurnsCore,
  loadMemoryEligibleChatTurnsWithMessageIdsCore,
  resolveMemoryEligibleTurnNumberCore,
} from "./memory-turn-loader";
import {
  executeAtomicMemoryResetCore,
  getMemorySourceBoundaryCore,
  initializeForkMemoryBoundaryCore,
  isMemorySourceEligible,
  isMemoryWriteGuardCurrentCore,
  resolveCanonicalSourceUserMessageIdCore,
} from "./memory-source-boundary";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      memory TEXT NOT NULL DEFAULT '',
      current_summary TEXT NOT NULL DEFAULT '',
      memory_meta TEXT NOT NULL DEFAULT '{}',
      memory_pending TEXT NOT NULL DEFAULT '[]',
      memory_archived_turns INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      user_message_id INTEGER,
      usage TEXT,
      status_widget_values_json TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE chat_memories (
      chat_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chat_turn_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      summary TEXT NOT NULL
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
    CREATE TABLE rp_numeric_state_current (
      chat_id INTEGER PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO chats
      (id, user_id, character_id, memory, current_summary, memory_meta,
       memory_pending, memory_archived_turns)
     VALUES (1, 10, 20, 'legacy', 'summary', ?, '["pending"]', 12)`
  ).run(
    JSON.stringify({
      ...EMPTY_MEMORY_META,
      items: ["ring"],
      promises: [{ text: "return", status: "open" }],
    })
  );
  db.prepare(`INSERT INTO rp_numeric_state_current (chat_id, value) VALUES (1, 77)`).run();
  return db;
}

function addMessage(
  db: Database.Database,
  role: "user" | "assistant",
  content: string,
  model = "",
  userMessageId: number | null = null
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO messages
          (chat_id, role, content, model, user_message_id, status_widget_values_json)
         VALUES (1,?,?,?,?,?)`
      )
      .run(role, content, model, userMessageId, `status:${content}`).lastInsertRowid
  );
}


before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("memory boundary lookup is fail-closed", () => {
  it("returns the default only when the row is absent", () => {
    const db = makeDb();
    assert.deepEqual(getMemorySourceBoundaryCore(db, 1), {
      resetAfterMessageId: null,
      epoch: 0,
    });
  });

  it("returns the persisted boundary and epoch", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, memory_reset_after_message_id, memory_epoch)
       VALUES (1,10,20,500,3)`
    ).run();
    assert.deepEqual(getMemorySourceBoundaryCore(db, 1), {
      resetAfterMessageId: 500,
      epoch: 3,
    });
  });

  it("throws when the boundary table or columns cannot be queried", () => {
    const missingTableDb = new Database(":memory:");
    assert.throws(
      () => getMemorySourceBoundaryCore(missingTableDb, 1),
      /no such table: chat_memories/
    );

    const missingColumnsDb = new Database(":memory:");
    missingColumnsDb.exec(`CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY)`);
    assert.throws(
      () => getMemorySourceBoundaryCore(missingColumnsDb, 1),
      /no such column/
    );
  });

  it("never lets a write guard return true when boundary lookup fails", () => {
    const db = new Database(":memory:");
    let returned = false;
    assert.throws(() => {
      returned = isMemoryWriteGuardCurrentCore(db, {
        chatId: 1,
        snapshot: { resetAfterMessageId: null, epoch: 0 },
      });
    }, /no such table: chat_memories/);
    assert.equal(returned, false);
  });
});

describe("A2 migration compatibility", () => {
  it("adds nullable provenance and default epoch without changing existing rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chat_memories (
        chat_id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL
      );
      CREATE TABLE chat_turn_summaries (
        id INTEGER PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        turn_number INTEGER NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE TABLE episodic_memory_facts (
        id INTEGER PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        source_turn INTEGER NOT NULL,
        fact_text TEXT NOT NULL
      );
      INSERT INTO chat_memories (chat_id, user_id, character_id) VALUES (1,10,20);
      INSERT INTO chat_turn_summaries (id, chat_id, turn_number, summary)
        VALUES (1,1,1,'existing summary');
      INSERT INTO episodic_memory_facts (id, chat_id, source_turn, fact_text)
        VALUES (1,1,1,'existing fact');
    `);

    ensureMemoryResetBoundaryColumns(db);
    ensureMemoryResetBoundaryColumns(db);

    assert.deepEqual(getMemorySourceBoundaryCore(db, 1), {
      resetAfterMessageId: null,
      epoch: 0,
    });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM chat_turn_summaries`).get().n,
      1
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts`).get().n,
      1
    );
    const summary = db.prepare(`SELECT * FROM chat_turn_summaries WHERE id=1`).get();
    const episodic = db.prepare(`SELECT * FROM episodic_memory_facts WHERE id=1`).get();
    assert.equal(summary.source_start_user_message_id, null);
    assert.equal(summary.source_end_user_message_id, null);
    assert.equal(episodic.source_user_message_id, null);
  });
});

describe("memory eligible count hot path", () => {
  for (const turnCount of [100, 500, 1000]) {
    it(`uses two metadata-only queries for ${turnCount} completed turns`, () => {
      const measuredSql: string[] = [];
      let measuring = false;
      const db = new Database(":memory:", {
        verbose: (sql: string) => {
          if (measuring) measuredSql.push(sql);
        },
      });
      db.exec(`
        CREATE TABLE chat_memories (
          chat_id INTEGER PRIMARY KEY,
          memory_reset_after_message_id INTEGER,
          memory_epoch INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          model TEXT NOT NULL DEFAULT '',
          user_message_id INTEGER,
          usage TEXT
        );
        INSERT INTO chat_memories
          (chat_id, memory_reset_after_message_id, memory_epoch) VALUES (1,NULL,0);
      `);
      const insert = db.prepare(
        `INSERT INTO messages
          (chat_id, role, content, model, user_message_id) VALUES (1,?,?,?,?)`
      );
      db.transaction(() => {
        for (let turn = 1; turn <= turnCount; turn += 1) {
          const userId = Number(insert.run("user", `user ${turn}`, "", null).lastInsertRowid);
          insert.run("assistant", `assistant ${turn}`, "model", userId);
        }
      })();

      measuring = true;
      const startedAt = performance.now();
      const actual = countMemoryEligibleCompletedTurnsCore(db, 1);
      const elapsedMs = performance.now() - startedAt;
      measuring = false;

      assert.equal(actual, turnCount);
      // libsql's better-sqlite3 verbose shim may emit 0 statements in this
      // environment. When it does fire, the hot path must stay two metadata
      // queries and must not load message content.
      if (measuredSql.length > 0) {
        assert.equal(measuredSql.length, 2);
        assert.equal(measuredSql.some((sql) => /SELECT[^;]*content/is.test(sql)), false);
      }
      console.info("MEMORY_ELIGIBLE_COUNT_BENCHMARK", {
        completed_turns: turnCount,
        additional_query_count: measuredSql.length,
        rows_scanned: turnCount * 2,
        elapsed_ms: Number(elapsedMs.toFixed(3)),
      });
    });
  }
});

describe("persistent memory reset boundary", () => {
  it("atomically clears persistent projections while preserving transcript and game state", () => {
    const db = makeDb();
    addMessage(db, "assistant", "opening", "greeting");
    const userId = addMessage(db, "user", "before");
    const assistantId = addMessage(db, "assistant", "before reply", "model", userId);
    db.prepare(
      `INSERT INTO chat_memories
        (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary,
         used_chars, message_count, summarized_turn_count, last_compressed_at)
       VALUES (1,10,20,'pin','recent','archive',16,1,6,'now')`
    ).run();
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary) VALUES (1,1,'old')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, category, subject, attribute, value, importance, fact_text)
       VALUES (1,1,'event','user','old','yes','important','old fact')`
    ).run();

    const result = db
      .transaction(() =>
        executeAtomicMemoryResetCore(db, {
          chatId: 1,
          userId: 10,
          characterId: 20,
          tier: "free",
        })
      )
      .immediate();

    assert.equal(result.boundaryAfter, assistantId);
    assert.equal(result.epochAfter, 1);
    assert.deepEqual(getMemorySourceBoundaryCore(db, 1), {
      resetAfterMessageId: assistantId,
      epoch: 1,
    });
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE chat_id=1`).get().n, 3);
    assert.equal(
      db.prepare(`SELECT status_widget_values_json FROM messages WHERE id=?`).get(assistantId)
        .status_widget_values_json,
      "status:before reply"
    );
    assert.equal(db.prepare(`SELECT value FROM rp_numeric_state_current WHERE chat_id=1`).get().value, 77);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=1`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=1`).get().n, 0);

    const memory = db.prepare(`SELECT * FROM chat_memories WHERE chat_id=1`).get();
    assert.equal(memory.pinned_facts, "");
    assert.equal(memory.recent_summary, "");
    assert.equal(memory.archive_summary, "");
    assert.equal(memory.message_count, 0);
    assert.equal(memory.summarized_turn_count, 0);
    const chat = db.prepare(`SELECT * FROM chats WHERE id=1`).get();
    assert.equal(chat.memory, "");
    assert.equal(chat.current_summary, "");
    assert.equal(chat.memory_pending, "[]");
    assert.equal(chat.memory_archived_turns, 0);
    assert.deepEqual(
      JSON.parse(chat.memory_meta),
      JSON.parse(JSON.stringify(EMPTY_MEMORY_META))
    );
  });

  it("uses epoch-relative eligible turns and advances epoch on repeated resets", () => {
    const db = makeDb();
    const preUser = addMessage(db, "user", "pre");
    addMessage(db, "assistant", "pre reply", "model", preUser);
    const first = db
      .transaction(() =>
        executeAtomicMemoryResetCore(db, {
          chatId: 1,
          userId: 10,
          characterId: 20,
          tier: "free",
        })
      )
      .immediate();
    const staleSnapshot = getMemorySourceBoundaryCore(db, 1);

    const postUser1 = addMessage(db, "user", "post 1");
    addMessage(db, "assistant", "post reply 1", "model", postUser1);
    const postUser2 = addMessage(db, "user", "post 2");
    addMessage(db, "assistant", "post reply 2", "model", postUser2);

    const turns = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, 1);
    assert.deepEqual(turns.map((turn) => turn.turnNumber), [1, 2]);
    assert.deepEqual(turns.map((turn) => turn.userMessageId), [postUser1, postUser2]);
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 2);
    assert.equal(resolveMemoryEligibleTurnNumberCore(db, 1, postUser2), 2);
    assert.equal(resolveMemoryEligibleTurnNumberCore(db, 1, preUser), null);
    assert.equal(
      resolveCanonicalSourceUserMessageIdCore(db, {
        chatId: 1,
        assistantMessageId: postUser1 + 1,
      }),
      postUser1
    );

    const second = db
      .transaction(() =>
        executeAtomicMemoryResetCore(db, {
          chatId: 1,
          userId: 10,
          characterId: 20,
          tier: "free",
        })
      )
      .immediate();
    assert.ok(second.boundaryAfter! > first.boundaryAfter!);
    assert.equal(second.epochAfter, 2);
    assert.equal(
      isMemoryWriteGuardCurrentCore(db, {
        chatId: 1,
        snapshot: staleSnapshot,
        sourceUserMessageIds: [postUser1],
      }),
      false
    );
    const staleEpisodic = reconcileEpisodicMemoryFactsForGeneration(db, {
      chatId: 1,
      characterId: 20,
      userId: 10,
      sourceTurn: 1,
      sourceUserMessageId: postUser1,
      boundarySnapshot: staleSnapshot,
      isRegeneration: false,
      facts: [
        {
          category: "event",
          subject: "user",
          attribute: "stale_event",
          value: "happened",
          importance: "important",
          fact_text: "The stale event happened.",
        },
      ],
    });
    assert.deepEqual(staleEpisodic, { replaced: false, inserted: 0 });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=1`).get().n,
      0
    );

    const third = db
      .transaction(() =>
        executeAtomicMemoryResetCore(db, {
          chatId: 1,
          userId: 10,
          characterId: 20,
          tier: "free",
        })
      )
      .immediate();
    assert.equal(third.boundaryAfter, second.boundaryAfter);
    assert.equal(third.epochAfter, 3);
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 0);
    assert.equal(
      isMemorySourceEligible({
        sourceUserMessageId: postUser2,
        boundary: getMemorySourceBoundaryCore(db, 1),
      }),
      false
    );
  });

  it("initializes independent child epochs and remaps both fork boundary cases", () => {
    const messageIdMap = new Map([
      [10, 101],
      [20, 102],
      [30, 103],
      [40, 104],
      [50, 105],
      [60, 106],
      [70, 107],
      [80, 108],
      [90, 109],
      [100, 110],
    ]);
    const copied = [...messageIdMap.keys()];
    const turnMessages = [
      { id: 10, role: "user", model: "" },
      { id: 20, role: "assistant", model: "model" },
      { id: 30, role: "user", model: "" },
      { id: 40, role: "assistant", model: "model" },
      { id: 50, role: "user", model: "" },
      { id: 60, role: "assistant", model: "model" },
    ];
    assert.equal(
      countMemoryEligibleCompletedTurnsUpToMessageId(turnMessages, 60, 20),
      2
    );
    assert.equal(
      remapForkResetBoundary({
        parentResetAfterMessageId: null,
        forkMessageId: 100,
        copiedParentMessageIds: copied,
        messageIdMap,
      }),
      null
    );
    assert.equal(
      remapForkResetBoundary({
        parentResetAfterMessageId: 80,
        forkMessageId: 100,
        copiedParentMessageIds: copied,
        messageIdMap,
      }),
      108
    );
    assert.equal(
      remapForkResetBoundary({
        parentResetAfterMessageId: 80,
        forkMessageId: 50,
        copiedParentMessageIds: copied.slice(0, 5),
        messageIdMap,
      }),
      105
    );

    const db = makeDb();
    db.prepare(`INSERT INTO chats (id, user_id, character_id) VALUES (2,10,20)`).run();
    initializeForkMemoryBoundaryCore(db, {
      chatId: 2,
      userId: 10,
      characterId: 20,
      tier: "free",
      resetAfterMessageId: 105,
    });
    assert.deepEqual(getMemorySourceBoundaryCore(db, 2), {
      resetAfterMessageId: 105,
      epoch: 0,
    });
    assert.deepEqual(getMemorySourceBoundaryCore(db, 1), {
      resetAfterMessageId: null,
      epoch: 0,
    });
  });
});
