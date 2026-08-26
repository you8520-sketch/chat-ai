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
import {
  __setSummarizeTurnBatchCallerForTests,
} from "./memory-rolling-summary";
import {
  __clearMigrationFinalShadowForTests,
  __peekMigrationFinalShadowForTests,
  migrateChatSummariesToFiveTurn,
} from "./memory-summary-migration";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  parseScopePayload,
} from "./memory-summary-scope";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import {
  buildScopePayloadFromShadowRecord,
  normalizeShadowRecordForCompare,
  ShadowState,
  syntheticShadowRecordId,
} from "./memory-shadow-state";
import type { MemoryRecordView } from "./memory-turn-summary";

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

const CHAT_A = 900101;
const USER_A = 900102;
const CHAR_A = 900103;
const CHAT_B = 900111;
const USER_B = 900112;
const CHAR_B = 900113;

function cleanupChat(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare("DELETE FROM memory_summary_migrations WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare("DELETE FROM characters WHERE id=?").run(charId);
}

function seedChat(
  chatId: number,
  userId: number,
  charId: number,
  charName: string
) {
  cleanupChat(chatId, userId, charId);
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    userId,
    `sh-${userId}@test.local`,
    "sh",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, charName);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  getOrCreateChatMemory(chatId, userId, charId, "free");
}

function seedTurns(
  chatId: number,
  specs: Array<{ turn: number; user: string; assistant: string }>
) {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "인사.",
    "greeting"
  );
  for (const spec of specs) {
    const userId = Number(
      db
        .prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`)
        .run(chatId, "user", spec.user).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
    ).run(chatId, "assistant", spec.assistant, userId);
  }
}

function seedLegacySixTurn(
  chatId: number,
  userId: number,
  charId: number,
  playableTurnCount: number
) {
  persistValidatedSummaryBatch({
    chatId,
    userId,
    characterId: charId,
    tier: "free",
    turnStart: 1,
    turnEnd: 6,
    assistantMessageId: null,
    summary: FIXTURE,
    playableTurnCount,
  });
}

function dbScopePayload(turnStart: number, chatId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT scope_payload FROM chat_turn_summaries
       WHERE chat_id=? AND turn_number=? AND inactive=0`
    )
    .get(chatId, turnStart) as { scope_payload: string | null } | undefined;
  return row?.scope_payload ? parseScopePayload(row.scope_payload) : null;
}

function normalizeDbAutomaticRecords(chatId: number) {
  return listMemoryRecordsForChat(chatId)
    .filter((row) => !row.inactive && !row.userEdited)
    .sort((a, b) => a.turnStart - b.turnStart)
    .map(normalizeShadowRecordForCompare);
}

function requireFinalMigrationShadow(chatId: number): MemoryRecordView[] {
  const snapshot = __peekMigrationFinalShadowForTests(chatId);
  assert.ok(
    snapshot,
    `expected migration final shadow snapshot for chat ${chatId} before DB swap`
  );
  return [...snapshot];
}

function assertDbMatchesFinalShadow(chatId: number, finalShadow: readonly MemoryRecordView[]) {
  const dbNorm = normalizeDbAutomaticRecords(chatId);
  const shadowNorm = finalShadow.map(normalizeShadowRecordForCompare);
  assert.deepEqual(dbNorm, shadowNorm);
  for (const record of finalShadow) {
    const scope = dbScopePayload(record.turnStart, chatId);
    assert.ok(scope);
    const expected = buildScopePayloadFromShadowRecord(record);
    assert.deepEqual(scope.scopes, expected.scopes);
    assert.equal(scope.branchId, expected.branchId);
    assert.equal(scope.branchStatus, expected.branchStatus);
    assert.equal(scope.promotedBy, expected.promotedBy);
  }
}

function ifUserText(turn: number): string {
  return `(OOC: IF 번외 장면 ${turn})`;
}

before(() => {
  __clearMigrationFinalShadowForTests();
  __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
});

after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __clearMigrationFinalShadowForTests();
  cleanupChat(CHAT_A, USER_A, CHAR_A);
  cleanupChat(CHAT_B, USER_B, CHAR_B);
});

describe("final shadow / DB consistency", () => {
  it("A batch2 promote updates final shadow and persisted DB batch1 branch_canon", async () => {
    seedChat(CHAT_A, USER_A, CHAR_A, "ShadowA");
    seedTurns(
      CHAT_A,
      Array.from({ length: 10 }, (_, i) => {
        const turn = i + 1;
        return {
          turn,
          user: turn <= 5 ? ifUserText(turn) : turn === 6 ? "계속" : ifUserText(turn),
          assistant: `IF 장면 ${turn}`,
        };
      })
    );
    seedLegacySixTurn(CHAT_A, USER_A, CHAR_A, 10);

    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT_A,
      userId: USER_A,
      characterId: CHAR_A,
      charName: "ShadowA",
    });
    assert.equal(result.status, "COMPLETED");

    const batch1 = listMemoryRecordsForChat(CHAT_A).find((row) => row.turnStart === 1);
    assert.ok(batch1);
    assert.equal(batch1.summaryKind, "branch_canon");
    assert.ok(batch1.scopes.branch_canon);
    assert.equal(dbScopePayload(1, CHAT_A)?.scopes.branch_canon, batch1.scopes.branch_canon);

    assert.equal(syntheticShadowRecordId(1), 1);
    assert.equal(syntheticShadowRecordId(6), 6);
    assertDbMatchesFinalShadow(CHAT_A, requireFinalMigrationShadow(CHAT_A));
  });

  it("B batch2 close sets final DB batch1 branch_status closed", async () => {
    seedChat(CHAT_A, USER_A, CHAR_A, "ShadowA");
    seedTurns(
      CHAT_A,
      Array.from({ length: 15 }, (_, i) => {
        const turn = i + 1;
        let user = ifUserText(turn);
        if (turn === 6) user = "계속";
        if (turn === 11) user = "본편으로 돌아가";
        return { turn, user, assistant: `장면 ${turn}` };
      })
    );
    seedLegacySixTurn(CHAT_A, USER_A, CHAR_A, 15);

    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT_A,
      userId: USER_A,
      characterId: CHAR_A,
      charName: "ShadowA",
    });
    assert.equal(result.status, "COMPLETED");

    const batch1 = listMemoryRecordsForChat(CHAT_A).find((row) => row.turnStart === 1);
    assert.ok(batch1);
    assert.equal(batch1.branchStatus, "closed");
    assert.equal(
      getDb()
        .prepare(
          `SELECT branch_status FROM chat_turn_summaries WHERE chat_id=? AND turn_number=1`
        )
        .get(CHAT_A)?.branch_status,
      "closed"
    );
    assertDbMatchesFinalShadow(CHAT_A, requireFinalMigrationShadow(CHAT_A));
  });

  it("C closed branch reopen keeps final shadow and DB aligned", async () => {
    seedChat(CHAT_A, USER_A, CHAR_A, "ShadowA");
    seedTurns(
      CHAT_A,
      Array.from({ length: 20 }, (_, i) => {
        const turn = i + 1;
        let user = ifUserText(turn);
        if (turn === 6) user = "계속";
        if (turn === 11) user = "본편으로 돌아가";
        if (turn >= 12 && turn <= 15) user = `본편 대화 ${turn}`;
        if (turn === 16) user = "아까 IF 이어서";
        return { turn, user, assistant: `장면 ${turn}` };
      })
    );
    seedLegacySixTurn(CHAT_A, USER_A, CHAR_A, 20);

    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT_A,
      userId: USER_A,
      characterId: CHAR_A,
      charName: "ShadowA",
    });
    assert.equal(result.status, "COMPLETED");

    const records = listMemoryRecordsForChat(CHAT_A).filter(
      (row) => !row.inactive && !row.userEdited
    );
    const batch1 = records.find((row) => row.turnStart === 1);
    const batch4 = records.find((row) => row.turnStart === 16);
    assert.ok(batch1);
    assert.ok(batch4);
    assert.equal(batch4.summaryKind, "branch_canon");
    assert.equal(batch4.branchStatus, "active");
    assert.ok(batch1.branchId);
    assert.equal(batch1.branchId, batch4.branchId);
    assert.equal(batch1.branchStatus, "active");
    assertDbMatchesFinalShadow(CHAT_A, requireFinalMigrationShadow(CHAT_A));
  });

  it("concurrent migrations use isolated shadow ids and correct final DB state", async () => {
    seedChat(CHAT_A, USER_A, CHAR_A, "Alpha");
    seedChat(CHAT_B, USER_B, CHAR_B, "Beta");

    seedTurns(
      CHAT_A,
      Array.from({ length: 10 }, (_, i) => ({
        turn: i + 1,
        user: `Alpha RP ${i + 1}`,
        assistant: `Alpha ${i + 1}`,
      }))
    );
    seedTurns(
      CHAT_B,
      Array.from({ length: 10 }, (_, i) => ({
        turn: i + 1,
        user: `Beta RP ${i + 1}`,
        assistant: `Beta ${i + 1}`,
      }))
    );
    seedLegacySixTurn(CHAT_A, USER_A, CHAR_A, 10);
    seedLegacySixTurn(CHAT_B, USER_B, CHAR_B, 10);

    let releaseChatB: (() => void) | null = null;
    const chatBStartGate = new Promise<void>((resolve) => {
      releaseChatB = resolve;
    });
    let chatBShadowInitDone = false;

    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      const content = history[0]?.content ?? "";
      if (content.includes("Alpha RP") && /\[1~5턴/.test(content)) {
        releaseChatB?.();
        while (!chatBShadowInitDone) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
      if (content.includes("Beta RP") && /\[1~5턴/.test(content)) {
        chatBShadowInitDone = true;
      }
      return { text: FIXTURE };
    });

    const migrateB = async () => {
      await chatBStartGate;
      return migrateChatSummariesToFiveTurn({
        chatId: CHAT_B,
        userId: USER_B,
        characterId: CHAR_B,
        charName: "Beta",
      });
    };

    const [resultA, resultB] = await Promise.all([
      migrateChatSummariesToFiveTurn({
        chatId: CHAT_A,
        userId: USER_A,
        characterId: CHAR_A,
        charName: "Alpha",
      }),
      migrateB(),
    ]);

    assert.equal(resultA.status, "COMPLETED");
    assert.equal(resultB.status, "COMPLETED");

    const idsA = listMemoryRecordsForChat(CHAT_A)
      .filter((row) => !row.inactive && !row.userEdited)
      .map((row) => row.turnStart);
    const idsB = listMemoryRecordsForChat(CHAT_B)
      .filter((row) => !row.inactive && !row.userEdited)
      .map((row) => row.turnStart);
    assert.deepEqual([...new Set(idsA)].sort(), idsA.sort());
    assert.deepEqual([...new Set(idsB)].sort(), idsB.sort());
    assert.deepEqual(idsA, [1, 6]);
    assert.deepEqual(idsB, [1, 6]);
    assert.equal(syntheticShadowRecordId(1), 1);
    assert.equal(syntheticShadowRecordId(6), 6);

    assertDbMatchesFinalShadow(CHAT_A, requireFinalMigrationShadow(CHAT_A));
    assertDbMatchesFinalShadow(CHAT_B, requireFinalMigrationShadow(CHAT_B));
  });
});

describe("ShadowState unit", () => {
  it("deterministic ids are unique within one chat shadow", () => {
    const state = new ShadowState();
    state.appendFromComposed(
      { turnStart: 1, turnEnd: 5 },
      {
        summaryKind: "noncanon",
        scopes: { noncanon: "a" },
        branchId: null,
        branchStatus: null,
        promotedBy: null,
        promotedAt: null,
        displaySummary: "a",
      },
      { sourceStartUserMessageId: 1, sourceEndUserMessageId: 2, assistantMessageId: 3 }
    );
    state.applyPendingOps([
      {
        op: "promote_noncanon_records",
        recordIds: [syntheticShadowRecordId(1)],
        branchId: "branch-x",
        promotedBy: "user_continue",
        sourceTurn: 6,
        control: { source: "user_turn", sourceUserMessageId: 9, sourceTurn: 6 },
      },
    ]);
    state.appendFromComposed(
      { turnStart: 6, turnEnd: 10 },
      {
        summaryKind: "branch_canon",
        scopes: { branch_canon: "b" },
        branchId: "branch-x",
        branchStatus: "active",
        promotedBy: "user_continue",
        promotedAt: new Date().toISOString(),
        displaySummary: "b",
      },
      { sourceStartUserMessageId: 4, sourceEndUserMessageId: 5, assistantMessageId: 6 }
    );
    const final = state.finalRecords();
    assert.equal(final.length, 2);
    assert.equal(final[0]?.summaryKind, "branch_canon");
    assert.equal(final[0]?.branchId, "branch-x");
    assert.equal(final[0]?.id, syntheticShadowRecordId(1));
    assert.equal(final[1]?.id, syntheticShadowRecordId(6));
  });
});
