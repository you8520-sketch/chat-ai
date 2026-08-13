import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { EMPTY_MEMORY_META } from "@/lib/chatMemory";
import { encodeScopePayload } from "./memory-summary-scope";
import {
  copyForkEpisodicMemoryFacts,
  copyForkLorebookActiveEntries,
  copyForkNumericState,
  copyForkStatusTriggerEvents,
  copyForkTurnSummaries,
  countCompletedTurnsUpToMessageId,
  forkSummarizedTurnCount,
  isForkMutationAfterBoundary,
  remapCopiedUserMessageIds,
  snapshotForkRelationshipMeta,
} from "./memory-fork-snapshot";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      user_message_id INTEGER
    );
    CREATE TABLE chat_turn_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      assistant_message_id INTEGER,
      source_start_user_message_id INTEGER,
      source_end_user_message_id INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      summary_kind TEXT NOT NULL DEFAULT 'narrative',
      user_edited INTEGER NOT NULL DEFAULT 0,
      scope_payload TEXT,
      branch_id TEXT,
      branch_status TEXT,
      promoted_by TEXT,
      promoted_at TEXT,
      inactive INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chat_id, turn_number)
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
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE lorebook_active_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      lorebook_id INTEGER NOT NULL,
      entry_key TEXT NOT NULL,
      content TEXT NOT NULL,
      keyword TEXT NOT NULL DEFAULT '',
      last_source TEXT NOT NULL DEFAULT 'recent_raw',
      last_turn INTEGER NOT NULL,
      expires_after_turn INTEGER NOT NULL
    );
    CREATE TABLE status_trigger_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      trigger_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      source_turn INTEGER NOT NULL,
      effect_text TEXT NOT NULL,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      fired_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT,
      metadata TEXT,
      source_message_id INTEGER,
      request_id TEXT,
      generation_sequence INTEGER,
      is_superseded INTEGER NOT NULL DEFAULT 0,
      superseded_at TEXT,
      superseded_reason TEXT
    );
    CREATE TABLE rp_numeric_state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      state_key TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      before_value REAL,
      proposed_value REAL,
      proposed_delta REAL,
      applied_delta REAL,
      after_value REAL,
      outcome TEXT NOT NULL,
      adjustments_json TEXT NOT NULL DEFAULT '[]',
      source_turn INTEGER,
      assistant_message_id INTEGER,
      request_id TEXT,
      generation_sequence INTEGER,
      source_kind TEXT NOT NULL,
      replaces_event_id INTEGER,
      revision_before INTEGER,
      revision_after INTEGER,
      policy_version INTEGER NOT NULL DEFAULT 1,
      definition_hash TEXT,
      idempotency_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE rp_numeric_state_current (
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      state_key TEXT NOT NULL,
      numeric_value REAL NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      last_event_id INTEGER,
      last_source_turn INTEGER,
      last_source_message_id INTEGER,
      last_request_id TEXT,
      last_generation_sequence INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, state_key)
    );
  `);
  return db;
}

describe("memory-fork-snapshot", () => {
  it("counts completed turns up to message id", () => {
    const messages = [
      { id: 1, role: "user", model: "" },
      { id: 2, role: "assistant", model: "greeting" },
      { id: 3, role: "user", model: "" },
      { id: 4, role: "assistant", model: "deepseek" },
      { id: 5, role: "user", model: "" },
      { id: 6, role: "assistant", model: "deepseek" },
      { id: 7, role: "user", model: "" },
    ];

    assert.equal(countCompletedTurnsUpToMessageId(messages, 4), 1);
    assert.equal(countCompletedTurnsUpToMessageId(messages, 6), 2);
    assert.equal(countCompletedTurnsUpToMessageId(messages, 7), 2);
  });

  it("forkSummarizedTurnCount floors to completed 6-turn batches", () => {
    assert.equal(forkSummarizedTurnCount(0), 0);
    assert.equal(forkSummarizedTurnCount(5), 0);
    assert.equal(forkSummarizedTurnCount(6), 6);
    assert.equal(forkSummarizedTurnCount(13), 12);
    assert.equal(forkSummarizedTurnCount(200), 198);
  });

  it("does not copy parent relationship ledger entries that only exist after the fork", () => {
    const json = snapshotForkRelationshipMeta({
      parentMemoryMeta: JSON.stringify({
        honorifics: ["렌→레온: 당신"],
        items: ["레온: 낡은 열쇠", "레온: 마법검"],
        thoughts: ["레온: 400턴의 속마음"],
        promises: [{ text: "정원에서 만나자" }, { text: "왕을 배신하겠다" }],
        currentLocation: "왕궁 지하",
      }),
      copiedContents: [
        "렌이 레온을 당신이라고 불렀다",
        "레온: 낡은 열쇠를 쥐었다",
        "정원에서 만나자며 약속했다",
      ],
    });
    const meta = JSON.parse(json) as {
      honorifics: string[];
      items: string[];
      thoughts: string[];
      promises: { text: string }[];
      currentLocation?: string;
    };
    assert.deepEqual(meta.items, ["레온: 낡은 열쇠"]);
    assert.deepEqual(meta.promises.map((p) => p.text), ["정원에서 만나자"]);
    assert.deepEqual(meta.thoughts, []);
    assert.equal(meta.currentLocation, undefined);
    assert.ok(meta.honorifics.length === 0 || meta.honorifics.includes("렌→레온: 당신"));
  });

  it("returns empty relationship meta when nothing from the parent ledger appears pre-fork", () => {
    const json = snapshotForkRelationshipMeta({
      parentMemoryMeta: JSON.stringify({
        ...EMPTY_MEMORY_META,
        items: ["레온: 마법검"],
        currentLocation: "왕궁",
      }),
      copiedContents: ["평범한 인사만 오갔다"],
    });
    const parsed = JSON.parse(json) as {
      honorifics: string[];
      items: string[];
      thoughts: string[];
      promises: unknown[];
      currentLocation?: string;
    };
    assert.deepEqual(parsed.honorifics, []);
    assert.deepEqual(parsed.items, []);
    assert.deepEqual(parsed.promises, []);
    assert.deepEqual(parsed.thoughts, []);
    assert.equal(parsed.currentLocation, undefined);
  });

  it("treats branch mutations sourced after the fork message as later-worldline", () => {
    assert.equal(
      isForkMutationAfterBoundary(
        {
          action: "close_branch",
          source: "user_turn",
          sourceUserMessageId: 350,
          at: "2026-01-01T00:00:00.000Z",
          previous: {
            summaryKind: "branch_canon",
            scopes: { branch_canon: "early branch" },
            branchId: "b1",
            branchStatus: "active",
            promotedBy: null,
            promotedAt: null,
          },
        },
        200,
        198
      ),
      true
    );
    assert.equal(
      isForkMutationAfterBoundary(
        {
          action: "close_branch",
          source: "user_turn",
          sourceUserMessageId: 80,
          at: "2026-01-01T00:00:00.000Z",
          previous: {
            summaryKind: "branch_canon",
            scopes: { branch_canon: "early branch" },
            branchId: "b1",
            branchStatus: "active",
            promotedBy: null,
            promotedAt: null,
          },
        },
        200,
        198
      ),
      false
    );
  });

  it("copies 6-turn pages up to the fork and rewinds later branch-close mutations", () => {
    const db = makeDb();
    const messageIdMap = new Map([
      [10, 110],
      [11, 111],
      [20, 120],
      [21, 121],
    ]);
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, source_start_user_message_id,
         source_end_user_message_id, summary, summary_kind, branch_status, scope_payload)
       VALUES (1, 1, 11, 10, 10, '1~6 정원', 'main_canon', NULL, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, source_start_user_message_id,
         source_end_user_message_id, summary, summary_kind, branch_id, branch_status, scope_payload)
       VALUES (1, 7, 21, 20, 20, 'closed later', 'main_canon', 'b1', 'closed', ?)`
    ).run(
      encodeScopePayload({
        v: 1,
        scopes: { main_canon: "closed later" },
        branchId: "b1",
        branchStatus: "closed",
        branchControlMutations: [
          {
            action: "close_branch",
            source: "user_turn",
            sourceUserMessageId: 900,
            sourceTurn: 250,
            at: "2026-01-01T00:00:00.000Z",
            previous: {
              summaryKind: "branch_canon",
              scopes: { branch_canon: "7~12 분기 진행" },
              branchId: "b1",
              branchStatus: "active",
              promotedBy: null,
              promotedAt: null,
            },
          },
        ],
      })
    );
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, summary)
       VALUES (1, 199, 999, '199~204 이후 요약')`
    ).run();

    const copied = copyForkTurnSummaries(db, {
      sourceChatId: 1,
      newChatId: 2,
      forkTurnCount: 12,
      forkMessageId: 21,
      messageIdMap,
    });
    assert.equal(copied, 2);
    const child = db
      .prepare(
        `SELECT turn_number, summary, summary_kind, branch_status
         FROM chat_turn_summaries WHERE chat_id=2 ORDER BY turn_number`
      )
      .all() as Array<{
      turn_number: number;
      summary: string;
      summary_kind: string;
      branch_status: string | null;
    }>;
    assert.equal(child.length, 2);
    assert.equal(child[0]?.summary, "1~6 정원");
    assert.equal(child[1]?.summary_kind, "branch_canon");
    assert.equal(child[1]?.branch_status, "active");
    assert.equal(child[1]?.summary, "7~12 분기 진행");
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS c FROM chat_turn_summaries WHERE chat_id=2 AND turn_number=199`).get()
        .c,
      0
    );
  });

  it("copies episodic facts from before the fork and remaps source message ids", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
       VALUES (1, 40, 10, 'item', '레온', 'key', '낡은 열쇠', 'important', '레온은 낡은 열쇠를 가지고 있다', '{"assistant_message_id":11}')`
    ).run();
    db.prepare(
      `INSERT INTO episodic_memory_facts
        (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text)
       VALUES (1, 300, 900, 'item', '레온', 'sword', '마법검', 'critical', '레온은 마법검을 얻었다')`
    ).run();
    const copied = copyForkEpisodicMemoryFacts(db, {
      sourceChatId: 1,
      newChatId: 2,
      forkTurnCount: 200,
      parentResetAfterMessageId: null,
      messageIdMap: new Map([
        [10, 110],
        [11, 111],
      ]),
    });
    assert.equal(copied, 1);
    const row = db
      .prepare(`SELECT source_turn, source_user_message_id, fact_text, metadata FROM episodic_memory_facts WHERE chat_id=2`)
      .get() as {
      source_turn: number;
      source_user_message_id: number;
      fact_text: string;
      metadata: string;
    };
    assert.equal(row.source_turn, 40);
    assert.equal(row.source_user_message_id, 110);
    assert.ok(row.fact_text.includes("낡은 열쇠"));
    assert.equal(JSON.parse(row.metadata).assistant_message_id, 111);
  });

  it("does not copy lorebook carryover that last matched after the fork", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO lorebook_active_entries
        (chat_id, lorebook_id, entry_key, content, last_turn, expires_after_turn)
       VALUES (1, 5, 'early', '초반 설정', 40, 50)`
    ).run();
    db.prepare(
      `INSERT INTO lorebook_active_entries
        (chat_id, lorebook_id, entry_key, content, last_turn, expires_after_turn)
       VALUES (1, 5, 'late', '후반 설정', 350, 360)`
    ).run();
    const copied = copyForkLorebookActiveEntries(db, {
      sourceChatId: 1,
      newChatId: 2,
      forkTurnCount: 200,
    });
    assert.equal(copied, 1);
    const keys = db
      .prepare(`SELECT entry_key FROM lorebook_active_entries WHERE chat_id=2`)
      .all() as { entry_key: string }[];
    assert.deepEqual(keys.map((row) => row.entry_key), ["early"]);
  });

  it("copies status trigger events tied to copied messages only", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO status_trigger_events (chat_id, trigger_id, event_key, source_turn, effect_text, source_message_id)
       VALUES (1, 't-early', 'e1', 40, 'early fire', 11)`
    ).run();
    db.prepare(
      `INSERT INTO status_trigger_events (chat_id, trigger_id, event_key, source_turn, effect_text, source_message_id)
       VALUES (1, 't-late', 'e2', 300, 'late fire', 900)`
    ).run();
    const copied = copyForkStatusTriggerEvents(db, {
      sourceChatId: 1,
      newChatId: 2,
      forkTurnCount: 200,
      messageIdMap: new Map([[11, 111]]),
    });
    assert.equal(copied, 1);
    const row = db
      .prepare(`SELECT trigger_id, source_message_id FROM status_trigger_events WHERE chat_id=2`)
      .get() as { trigger_id: string; source_message_id: number };
    assert.equal(row.trigger_id, "t-early");
    assert.equal(row.source_message_id, 111);
  });

  it("rebuilds numeric current from events at the fork, not the parent tip", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO rp_numeric_state_events
        (chat_id, state_key, mutation_id, after_value, outcome, source_kind,
         revision_before, revision_after, idempotency_key, assistant_message_id, source_turn)
       VALUES (1, 'affection', 'm1', 20, 'APPLIED', 'extractor', 0, 1, 'k1', 11, 40)`
    ).run();
    db.prepare(
      `INSERT INTO rp_numeric_state_events
        (chat_id, state_key, mutation_id, after_value, outcome, source_kind,
         revision_before, revision_after, idempotency_key, assistant_message_id, source_turn)
       VALUES (1, 'affection', 'm2', 80, 'APPLIED', 'extractor', 1, 2, 'k2', 900, 300)`
    ).run();
    db.prepare(
      `INSERT INTO rp_numeric_state_current (chat_id, state_key, numeric_value, revision)
       VALUES (1, 'affection', 80, 2)`
    ).run();
    const copied = copyForkNumericState(db, {
      sourceChatId: 1,
      newChatId: 2,
      forkTurnCount: 200,
      messageIdMap: new Map([[11, 111]]),
    });
    assert.equal(copied, 1);
    const current = db
      .prepare(`SELECT numeric_value, last_source_message_id FROM rp_numeric_state_current WHERE chat_id=2 AND state_key='affection'`)
      .get() as { numeric_value: number; last_source_message_id: number };
    assert.equal(current.numeric_value, 20);
    assert.equal(current.last_source_message_id, 111);
  });

  it("remaps user_message_id on copied assistant rows", () => {
    const db = makeDb();
    db.prepare(`INSERT INTO messages (id, chat_id, role, content, user_message_id) VALUES (10, 1, 'user', 'hi', NULL)`).run();
    db.prepare(`INSERT INTO messages (id, chat_id, role, content, user_message_id) VALUES (11, 1, 'assistant', 'hello', 10)`).run();
    db.prepare(`INSERT INTO messages (id, chat_id, role, content, user_message_id) VALUES (110, 2, 'user', 'hi', NULL)`).run();
    db.prepare(`INSERT INTO messages (id, chat_id, role, content, user_message_id) VALUES (111, 2, 'assistant', 'hello', NULL)`).run();
    remapCopiedUserMessageIds(db, {
      sourceChatId: 1,
      forkMessageId: 11,
      messageIdMap: new Map([
        [10, 110],
        [11, 111],
      ]),
    });
    const row = db
      .prepare(`SELECT user_message_id FROM messages WHERE id=111`)
      .get() as { user_message_id: number };
    assert.equal(row.user_message_id, 110);
  });
});
