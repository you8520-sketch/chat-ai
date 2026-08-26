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
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { rollbackBranchControlMutationsForDeletedUserMessage } from "./memory-branch-control";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { resolveBatchStartForTurnNumber } from "./memory-summary-integrity";
import { parseScopePayload, type ScopePayloadV1 } from "./memory-summary-scope";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  closeActiveBranchCanon,
  countDistinctActiveBranchIds,
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  promoteRecordsToBranchCanon,
  rebuildLorebookFromRecords,
  reopenClosedBranchCanon,
  selectLatestContiguousNoncanonRecordIds,
} from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";

const ENV_KEY = "MEMORY_5PLUS4_ENABLED";
const CHAT = 922501;
const USER = 922591;
const CHAR = 922518;

const TEXT_A = "비정사 A: 현대 회사 IF에서 두 사람이 계약을 준비했다.";
const TEXT_B = "비정사 B: 학교 배경 IF에서 시험 전날 대화를 나눴다.";
const TEXT_C = "비정사 C: 카페 IF가 이어지며 약속을 잡았다.";
const TEXT_MAIN =
  "레온은 연회장에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";
const TEXT_PREF = "앞으로 서술 톤은 차분하게 유지해 주세요.";
const TEXT_BRANCH = "분기: 현대 회사 IF가 이어지며 계약서에 서명하기 직전까지 진행됐다.";
const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

let savedEnv: string | undefined;

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seed() {
  cleanup();
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER, `p2-${USER}@test.local`, "p2-branch", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "P2Char");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT, USER, CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function insertMsg(role: "user" | "assistant", content: string): number {
  return Number(
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`)
      .run(CHAT, role, content).lastInsertRowid
  );
}

function seedPlayableTurns(
  count: number,
  turnFn?: (t: number) => { user: string; assistant: string }
) {
  getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    )
    .run(CHAT, "assistant", "인사.", "greeting");
  for (let t = 1; t <= count; t++) {
    const pair = turnFn
      ? turnFn(t)
      : t === count
        ? { user: "계속", assistant: "IF가 이어진다." }
        : { user: `본편 턴 ${t}`, assistant: `응답 ${t}` };
    insertMsg("user", pair.user);
    insertMsg("assistant", pair.assistant);
  }
}

function persistKind(opts: {
  turnStart: number;
  turnEnd?: number;
  kind: "noncanon" | "main_canon" | "branch_canon" | "preference" | "empty_ooc";
  text: string;
  branchId?: string;
  branchStatus?: "active" | "closed";
  inactive?: boolean;
}): number {
  const scopes: ScopePayloadV1["scopes"] = {};
  if (opts.kind === "noncanon") scopes.noncanon = opts.text;
  else if (opts.kind === "main_canon") scopes.main_canon = opts.text;
  else if (opts.kind === "branch_canon") scopes.branch_canon = opts.text;
  else if (opts.kind === "preference") scopes.preference = opts.text;
  else scopes.empty_ooc = opts.text;

  const payload: ScopePayloadV1 = {
    v: 1,
    scopes,
    branchId: opts.branchId ?? null,
    branchStatus: opts.branchStatus ?? null,
    promotedBy: opts.kind === "branch_canon" ? "user_continue" : null,
    promotedAt: opts.kind === "branch_canon" ? "2026-01-01T00:00:00.000Z" : null,
  };
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: opts.turnStart,
    turnEnd: opts.turnEnd ?? opts.turnStart + 4,
    assistantMessageId: null,
    summary: opts.text,
    summaryKind: opts.kind,
    scopePayload: payload,
    branchId: payload.branchId,
    branchStatus: payload.branchStatus,
    promotedBy: payload.promotedBy,
    promotedAt: payload.promotedAt,
    playableTurnCount: (opts.turnEnd ?? opts.turnStart + 4) + 20,
  });
  assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r));
  if (!r.ok) throw new Error("persist failed");
  if (opts.inactive) {
    getDb()
      .prepare(`UPDATE chat_turn_summaries SET inactive=1 WHERE id=?`)
      .run(r.record.id);
  }
  return r.record.id;
}

function row(id: number) {
  return listMemoryRecordsForChat(CHAT).find((r) => r.id === id)!;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  process.env[ENV_KEY] = "1";
  seed();
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

after(() => {
  cleanup();
});

describe("Phase2 branch/noncanon contract B2_1-B2_10", () => {
  it("B2_1 noncanon continue promotes latest contiguous group to branch_canon", async () => {
    persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    persistKind({ turnStart: 6, kind: "main_canon", text: TEXT_MAIN });
    persistKind({ turnStart: 11, kind: "noncanon", text: TEXT_B });
    persistKind({ turnStart: 16, kind: "main_canon", text: TEXT_MAIN });
    const idC = persistKind({ turnStart: 21, kind: "noncanon", text: TEXT_C });

    seedPlayableTurns(30, (t) =>
      t === 30
        ? { user: "계속", assistant: "카페 IF가 이어진다." }
        : { user: `(OOC: IF ${t})`, assistant: `장면 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P2Char",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(idC).summaryKind, "branch_canon");
    assert.ok(row(idC).branchId);
    assert.equal(row(idC).branchStatus, "active");
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 1)!.summaryKind, "noncanon");
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 11)!.summaryKind, "noncanon");
  });

  it("B2_2 close branch returns to main-only LTM", () => {
    const id = persistKind({
      turnStart: 1,
      kind: "branch_canon",
      text: TEXT_BRANCH,
      branchId: "branch-p2",
      branchStatus: "active",
    });
    closeActiveBranchCanon(CHAT, { source: "ui" });
    assert.equal(row(id).branchStatus, "closed");
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, /계약서에 서명/);
  });

  it("B2_3 reopen targeted closed branch", () => {
    const id = persistKind({
      turnStart: 1,
      kind: "branch_canon",
      text: TEXT_BRANCH.replace("현대 회사", "카페"),
      branchId: "branch-A",
      branchStatus: "closed",
    });
    const result = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: id,
      source: "ui_reopen",
    });
    assert.equal(result.ok, true);
    assert.equal(row(id).branchStatus, "active");
    assert.equal(row(id).branchId, "branch-A");
  });

  it("B2_4 delete rolls back branch promotion provenance", () => {
    const id = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    const continueId = insertMsg("user", "계속");
    insertMsg("assistant", "ok");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id],
      branchId: "branch-p2",
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 6,
        sourceBatchStart: 6,
      },
    });
    assert.equal(row(id).summaryKind, "branch_canon");
    getDb().prepare("DELETE FROM messages WHERE id=?").run(continueId);
    assert.ok(rollbackBranchControlMutationsForDeletedUserMessage(CHAT, continueId) >= 1);
    assert.equal(row(id).summaryKind, "noncanon");
    assert.equal(row(id).branchId, null);
  });

  it("B2_5 soft-delete then reseal at same 5-turn span", () => {
    persistKind({ turnStart: 1, kind: "main_canon", text: TEXT_MAIN });
    seedPlayableTurns(10);
    const first = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 6,
      assistantMessageId: null,
      summary: MOCK_SUMMARY,
      playableTurnCount: 10,
    });
    assert.equal(first.ok, true);
    markMemoryRecordInactive(CHAT, first.ok ? first.record.id : 0);
    const second = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 6,
      assistantMessageId: null,
      summary: MOCK_SUMMARY + " 재기록.",
      playableTurnCount: 10,
    });
    assert.equal(second.ok, true);
    const active = listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive && r.turnStart === 6);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.turnEnd, 10);
  });

  it("B2_6 preference and empty_ooc do not break noncanon group selection", () => {
    const b1 = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    persistKind({ turnStart: 6, kind: "preference", text: TEXT_PREF });
    persistKind({ turnStart: 11, kind: "empty_ooc", text: "__SUMMARY_KIND_OOC_ONLY__" });
    const b2 = persistKind({ turnStart: 16, kind: "noncanon", text: TEXT_B });
    assert.deepEqual(
      selectLatestContiguousNoncanonRecordIds(listMemoryRecordsForChat(CHAT)),
      [b1, b2]
    );
  });

  it("B2_7 only latest contiguous noncanon segment selected for promotion", async () => {
    persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    persistKind({ turnStart: 6, kind: "main_canon", text: TEXT_MAIN });
    persistKind({ turnStart: 11, kind: "noncanon", text: TEXT_B });
    persistKind({ turnStart: 16, kind: "main_canon", text: TEXT_MAIN });
    const idC = persistKind({ turnStart: 21, kind: "noncanon", text: TEXT_C });

    seedPlayableTurns(30);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P2Char",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(idC).summaryKind, "branch_canon");
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 1)!.summaryKind, "noncanon");
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 11)!.summaryKind, "noncanon");
  });

  it("B2_8 single active branch invariant on reopen", () => {
    const idA = persistKind({
      turnStart: 1,
      kind: "branch_canon",
      text: TEXT_BRANCH.replace("현대 회사", "분기A"),
      branchId: "branch-A",
      branchStatus: "closed",
    });
    persistKind({
      turnStart: 6,
      kind: "branch_canon",
      text: TEXT_BRANCH.replace("현대 회사", "분기B"),
      branchId: "branch-B",
      branchStatus: "active",
    });
    reopenClosedBranchCanon({ chatId: CHAT, recordId: idA, source: "ui_reopen" });
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(
      listMemoryRecordsForChat(CHAT).find((r) => r.branchId === "branch-B")!.branchStatus,
      "closed"
    );
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });

  it("B2_9 mixed legacy 1-6 / 7-12 + new 13-17 branch across frontier", () => {
    persistKind({
      turnStart: 1,
      turnEnd: 6,
      kind: "main_canon",
      text: TEXT_MAIN,
    });
    persistKind({
      turnStart: 7,
      turnEnd: 12,
      kind: "main_canon",
      text: TEXT_MAIN,
    });
    const branchId = persistKind({
      turnStart: 13,
      turnEnd: 17,
      kind: "branch_canon",
      text: TEXT_BRANCH,
      branchId: "branch-mixed",
      branchStatus: "active",
    });
    const rows = listMemoryRecordsForChat(CHAT);
    assert.equal(rows.find((r) => r.turnStart === 1)!.turnEnd, 6);
    assert.equal(rows.find((r) => r.turnStart === 7)!.turnEnd, 12);
    assert.equal(rows.find((r) => r.turnStart === 13)!.turnEnd, 17);
    assert.equal(row(branchId).summaryKind, "branch_canon");
  });

  it("B2_10 regen retains stored legacy 1-6 and new 13-17 spans", async () => {
    persistKind({ turnStart: 1, turnEnd: 6, kind: "main_canon", text: TEXT_MAIN });
    persistKind({ turnStart: 7, turnEnd: 12, kind: "main_canon", text: TEXT_MAIN });
    persistKind({
      turnStart: 13,
      turnEnd: 17,
      kind: "branch_canon",
      text: TEXT_BRANCH,
      branchId: "branch-regen",
      branchStatus: "active",
    });
    seedPlayableTurns(20);
    updateChatMemory(CHAT, USER, CHAR, {
      message_count: 20,
      summarized_turn_count: 17,
      membership_tier: "free",
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));
    const records = listMemoryRecordsForChat(CHAT);
    assert.equal(resolveBatchStartForTurnNumber(4, records), 1);
    assert.equal(resolveBatchStartForTurnNumber(15, records), 13);

    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P2Char",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 1,
      }),
      true
    );
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 1)!.turnEnd, 6);

    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P2Char",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 13,
      }),
      true
    );
    assert.equal(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 13)!.turnEnd, 17);
  });
});
