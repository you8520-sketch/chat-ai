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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getOrCreateChatMemory } from "./memory-db";
import { reconcileMemoryAfterRecordDelete } from "./memory-reconcile";
import {
  persistValidatedSummaryBatch,
  reconcileSummarizedTurnCountFromTable,
} from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import { shouldTriggerRollingSummary } from "./memory-rolling-summary";

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

const CHAT_ID = 990077;
const USER_ID = 990077;
const CHAR_ID = 990077;

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedPlayableTurns(count: number) {
  const db = getDb();
  cleanup();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER_ID, `soft-del-${USER_ID}@test.local`, "soft-del", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT_ID, USER_ID, CHAR_ID);

  for (let t = 1; t <= count; t++) {
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,datetime('now'))`
    ).run(CHAT_ID, "user", `유저 턴 ${t}`);
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,datetime('now'))`
    ).run(CHAT_ID, "assistant", `어시스턴트 턴 ${t} — ${FIXTURE}`);
  }
}

describe("soft-delete memory record reseal path", () => {
  before(() => {
    seedPlayableTurns(7);
  });
  after(() => {
    cleanup();
  });

  it("soft-deleted batch no longer counts as sealed; persist can revive it", () => {
    cleanup();
    seedPlayableTurns(7);

    const sealed = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 7,
    });
    assert.equal(sealed.ok, true);
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
    getDb()
      .prepare(
        `UPDATE chat_memories SET message_count=7, summarized_turn_count=6 WHERE chat_id=?`
      )
      .run(CHAT_ID);

    const row = listMemoryRecordsForChat(CHAT_ID)[0]!;
    assert.ok(markMemoryRecordInactive(CHAT_ID, row.id));
    assert.equal(listVisibleMemoryRecordsForChat(CHAT_ID).length, 0);
    assert.equal(rebuildLorebookFromRecords(CHAT_ID).trim(), "");

    // Pre-fix symptom: lorebook empty but inactive row still made counter look sealed.
    assert.equal(
      reconcileSummarizedTurnCountFromTable({
        chatId: CHAT_ID,
        userId: USER_ID,
        characterId: CHAR_ID,
        tier: "free",
        playableTurnCount: 7,
      }),
      0
    );
    assert.equal(shouldTriggerRollingSummary(7, 0), true);

    const revived = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 7,
    });
    assert.equal(revived.ok, true);
    if (!revived.ok) return;
    assert.equal(revived.record.inactive, false);
    assert.equal(listVisibleMemoryRecordsForChat(CHAT_ID).length, 1);
    assert.equal(revived.summarizedTurnCount, 6);
  });

  it("reconcileMemoryAfterRecordDelete zeros summarized_turn_count at turn 7", () => {
    cleanup();
    seedPlayableTurns(7);

    const sealed = persistValidatedSummaryBatch({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 7,
    });
    assert.equal(sealed.ok, true);
    getDb()
      .prepare(
        `UPDATE chat_memories SET message_count=7, summarized_turn_count=6 WHERE chat_id=?`
      )
      .run(CHAT_ID);

    const row = listMemoryRecordsForChat(CHAT_ID)[0]!;
    assert.ok(markMemoryRecordInactive(CHAT_ID, row.id));

    assert.equal(
      reconcileMemoryAfterRecordDelete({
        chatId: CHAT_ID,
        userId: USER_ID,
        characterId: CHAR_ID,
        charName: "TestChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );

    const mem = getDb()
      .prepare(
        `SELECT summarized_turn_count, message_count FROM chat_memories WHERE chat_id=?`
      )
      .get(CHAT_ID) as { summarized_turn_count: number; message_count: number };
    assert.equal(mem.summarized_turn_count, 0);
    assert.equal(mem.message_count, 7);
    assert.equal(shouldTriggerRollingSummary(mem.message_count, mem.summarized_turn_count), true);
  });
});
