import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getDb } from "@/lib/db";
import { syncMemoryFromChat } from "./memory-backfill";
import {
  buildOocOnlyBatchPlaceholder,
  buildSummaryBatchDiagnostics,
  highestContiguousCompletedTurn,
  OOC_ONLY_SUMMARY_MARKER,
} from "./memory-summary-integrity";
import {
  persistValidatedSummaryBatch,
  reconcileSummarizedTurnCountFromTable,
} from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import { buildRecentNarrativeContextBlock, buildStoredHistoryStaticBlock } from "./memory-narrative-context";
import { stripOocFromMemorySummary } from "./memory-ooc-filter";

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

const FIXTURE2 =
  "레온은 연회장에서 렌과의 약속을 기억하며 정원을 떠났다 → 다음날 훈련 중 다미안의 경고를 받고도 만남을 결심했다 → " +
  "마차로 렌을 데리러 가며 커프링크스를 소중히 간직했다 → 이별 시 내 심장은 당신 것이라 말했다.";

const CHAT_ID = 990044;
const USER_ID = 990001;
const CHAR_ID = 990018;

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seed() {
  const db = getDb();
  cleanup();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER_ID, `mem-test-${USER_ID}@test.local`, "mem-test", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT_ID, USER_ID, CHAR_ID);
}

function memCount(): number {
  const mem = getDb()
    .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?")
    .get(CHAT_ID) as { summarized_turn_count: number } | undefined;
  return mem?.summarized_turn_count ?? -1;
}

describe("persistValidatedSummaryBatch integrity", () => {
  before(() => {
    seed();
  });
  after(() => {
    cleanup();
  });

  it("valid 1~6 inserts row and sets count=6", () => {
    cleanup();
    seed();
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 13,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.summarizedTurnCount, 6);
    const rows = listMemoryRecordsForChat(CHAT_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.turnStart, 1);
    assert.equal(rows[0]!.summaryKind, "main_canon");
  });

  it("valid 7~12 coexists with 1~6 and sets count=12", () => {
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: FIXTURE2,
      playableTurnCount: 13,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.summarizedTurnCount, 12);
    const rows = listMemoryRecordsForChat(CHAT_ID);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((x) => x.turnStart),
      [1, 7]
    );
  });

  it("batch 7 cannot complete while batch 1 is missing", () => {
    cleanup();
    seed();
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: FIXTURE2,
      playableTurnCount: 13,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "SUMMARY_BATCH_GAP");
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, 0);
  });

  it("empty summary leaves state unchanged", () => {
    cleanup();
    seed();
    persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 13,
    });
    const before = listMemoryRecordsForChat(CHAT_ID);
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: "",
      playableTurnCount: 13,
    });
    assert.equal(r.ok, false);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, before.length);
  });

  it("OOC strip empty result does not create a narrative summary row", () => {
    cleanup();
    seed();
    const stripped = stripOocFromMemorySummary(
      "(OOC: 트위터 목업만) (OOC: SNS UI만) (OOC: HTML mock)"
    );
    assert.equal(stripped.trim(), "");
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: stripped,
      summaryKind: "main_canon",
      playableTurnCount: 13,
    });
    assert.equal(r.ok, false);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, 0);
    assert.notEqual(memCount(), 6);
  });

  it("duplicate same-batch upsert is idempotent", () => {
    cleanup();
    seed();
    const a = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 13,
    });
    const b = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE + " → 추가 구절이 이어진다.",
      playableTurnCount: 13,
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, 1);
  });

  it("reconcile pulls counter down when only 7~12 exists", () => {
    cleanup();
    seed();
    const db = getDb();
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary, summary_kind) VALUES (?,?,?,?)`
    ).run(CHAT_ID, 7, FIXTURE2, "main_canon");
    db.prepare(
      `INSERT INTO chat_memories (chat_id, user_id, character_id, recent_summary, summarized_turn_count, membership_tier, used_chars)
       VALUES (?,?,?,?,12,'free',?)`
    ).run(CHAT_ID, USER_ID, CHAR_ID, "[7~12턴] x", FIXTURE2.length);

    const n = reconcileSummarizedTurnCountFromTable({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      playableTurnCount: 13,
    });
    assert.equal(n, 0);
    assert.equal(memCount(), 0);
  });

  it("OOC-only placeholder has kind, counts contiguous, excluded from recent/prompt/UI", () => {
    cleanup();
    seed();
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: buildOocOnlyBatchPlaceholder(1, 6),
      summaryKind: "empty_ooc",
      playableTurnCount: 13,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.summarizedTurnCount, 6);
    assert.equal(r.record.summaryKind, "empty_ooc");
    assert.equal(r.record.summary, OOC_ONLY_SUMMARY_MARKER);

    const all = listMemoryRecordsForChat(CHAT_ID);
    assert.equal(all[0]!.summaryKind, "empty_ooc");
    assert.equal(listVisibleMemoryRecordsForChat(CHAT_ID).length, 0);

    const recent = rebuildLorebookFromRecords(CHAT_ID);
    assert.equal(recent.includes(OOC_ONLY_SUMMARY_MARKER), false);
    assert.equal(recent.trim(), "");

    const db = getDb();
    const mem = db
      .prepare("SELECT recent_summary, summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT_ID) as { recent_summary: string; summarized_turn_count: number };
    assert.equal(mem.summarized_turn_count, 6);
    assert.equal((mem.recent_summary || "").includes(OOC_ONLY_SUMMARY_MARKER), false);

    assert.equal(buildRecentNarrativeContextBlock(CHAT_ID, 13), "");
    assert.equal(buildStoredHistoryStaticBlock(CHAT_ID, 13), "");

    // next narrative batch can follow; contiguous remains complete through ooc
    const r2 = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: FIXTURE2,
      playableTurnCount: 13,
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.summarizedTurnCount, 12);
    const lore = rebuildLorebookFromRecords(CHAT_ID);
    assert.match(lore, /\[7~12턴\]/);
    assert.equal(lore.includes(OOC_ONLY_SUMMARY_MARKER), false);
    assert.equal(listVisibleMemoryRecordsForChat(CHAT_ID).length, 1);
  });

  it("ooc_only re-persist is idempotent (no duplicate row)", () => {
    cleanup();
    seed();
    const a = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: buildOocOnlyBatchPlaceholder(1, 6),
      summaryKind: "empty_ooc",
      playableTurnCount: 7,
    });
    const b = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: buildOocOnlyBatchPlaceholder(1, 6),
      summaryKind: "empty_ooc",
      playableTurnCount: 7,
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, 1);
  });

  it("transaction rollback after upsert keeps row/count unchanged", () => {
    cleanup();
    seed();
    const beforeRows = listMemoryRecordsForChat(CHAT_ID).length;
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 13,
      __testThrowAfterUpsert: true,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(
      r.reason === "SUMMARY_SAVE_FAILED" || r.reason === "SUMMARY_TRANSACTION_ROLLBACK"
    );
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, beforeRows);
    const mem = getDb()
      .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT_ID) as { summarized_turn_count: number } | undefined;
    assert.ok(!mem || mem.summarized_turn_count === 0);
  });

  it("reconcile twice is idempotent", () => {
    cleanup();
    seed();
    persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 13,
    });
    persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: FIXTURE2,
      playableTurnCount: 13,
    });
    const a = reconcileSummarizedTurnCountFromTable({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      playableTurnCount: 13,
    });
    const recentA = rebuildLorebookFromRecords(CHAT_ID);
    const rowsA = listMemoryRecordsForChat(CHAT_ID).map((r) => r.turnStart);
    const b = reconcileSummarizedTurnCountFromTable({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      playableTurnCount: 13,
    });
    assert.equal(a, 12);
    assert.equal(b, 12);
    assert.equal(rebuildLorebookFromRecords(CHAT_ID), recentA);
    assert.deepEqual(
      listMemoryRecordsForChat(CHAT_ID).map((r) => r.turnStart),
      rowsA
    );
  });

  it("syncMemoryFromChat does not jump count from playable turns alone", () => {
    cleanup();
    seed();
    const db = getDb();
    for (let i = 0; i < 12; i++) {
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
      ).run(CHAT_ID, "user", `u${i}`, "");
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
      ).run(CHAT_ID, "assistant", `a${i} `.repeat(20), "test");
    }
    // message_count stays 0 until sync — no summary rows
    const ok = syncMemoryFromChat({
      userId: USER_ID,
      characterId: CHAR_ID,
      chatId: CHAT_ID,
      charName: "TestChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(ok, true);
    assert.equal(memCount(), 0);
    assert.equal(listMemoryRecordsForChat(CHAT_ID).length, 0);
  });

  it("batch 1+13 only → contiguous count 6", () => {
    cleanup();
    seed();
    const db = getDb();
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary, summary_kind) VALUES (?,?,?,?)`
    ).run(CHAT_ID, 1, FIXTURE, "main_canon");
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, summary, summary_kind) VALUES (?,?,?,?)`
    ).run(CHAT_ID, 13, FIXTURE2, "main_canon");
    const records = listMemoryRecordsForChat(CHAT_ID);
    assert.equal(highestContiguousCompletedTurn(records, 20), 6);
    const n = reconcileSummarizedTurnCountFromTable({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      playableTurnCount: 20,
    });
    assert.equal(n, 6);
  });
});

describe("chat 44 local DB integrity snapshot", () => {
  it("reload-stable: turns 1+7 narrative, count=12, SUMMARY_OK, no duplicates", () => {
    const db = getDb();
    const chat = db.prepare("SELECT id FROM chats WHERE id=44").get() as { id: number } | undefined;
    if (!chat) {
      // CI / fresh DB without local fixture — skip
      return;
    }
    const snap = () => {
      const mem = db
        .prepare(
          "SELECT summarized_turn_count, recent_summary, message_count FROM chat_memories WHERE chat_id=44"
        )
        .get() as {
        summarized_turn_count: number;
        recent_summary: string;
        message_count: number;
      };
      const rows = listMemoryRecordsForChat(44);
      const diag = buildSummaryBatchDiagnostics({
        chatId: 44,
        records: rows,
        playableTurnCount: mem.message_count,
        summarizedTurnCount: mem.summarized_turn_count,
        recentSummary: mem.recent_summary || "",
      });
      return {
        starts: rows.map((r) => r.turnStart),
        kinds: rows.map((r) => r.summaryKind),
        count: mem.summarized_turn_count,
        reason: diag.reasonCode,
        visible: listVisibleMemoryRecordsForChat(44).map((r) => r.turnStart),
      };
    };
    const a = snap();
    const b = snap();
    assert.deepEqual(a.starts, [1, 7]);
    assert.deepEqual(a.kinds, ["main_canon", "main_canon"]);
    assert.equal(a.count, 12);
    assert.equal(a.reason, "SUMMARY_OK");
    assert.deepEqual(a.visible, [1, 7]);
    assert.deepEqual(a, b);
    assert.equal(a.starts.length, new Set(a.starts).size);
  });
});
