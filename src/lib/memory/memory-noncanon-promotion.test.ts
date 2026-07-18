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
import { parseScopePayload, type ScopePayloadV1 } from "./memory-summary-scope";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  countDistinctActiveBranchIds,
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  selectLatestContiguousNoncanonRecordIds,
} from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";

const CHAT = 931901;
const USER = 931991;
const CHAR = 931918;

const TEXT_A = "비정사 A: 현대 회사 IF에서 두 사람이 계약을 준비했다.";
const TEXT_B = "비정사 B: 학교 배경 IF에서 시험 전날 대화를 나눴다.";
const TEXT_C = "비정사 C: 카페 IF가 이어지며 약속을 잡았다.";
const TEXT_B1 = "비정사 B1: 학교 IF 전반 장면이 진행됐다.";
const TEXT_B2 = "비정사 B2: 학교 IF 후반 장면이 이어졌다.";
const TEXT_B3 = "비정사 B3: 학교 IF 결말 직전 장면이다.";
const TEXT_MAIN =
  "레온은 연회장에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";
const TEXT_PREF = "앞으로 서술 톤은 차분하게 유지해 주세요.";
const TEXT_BRANCH_C = "분기C: 활성 분기에서 계약 장면이 이어지고 있다.";
const TEXT_BRANCH_A = "분기A: 종료된 분기에서 카페 IF가 마무리됐다.";

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
  ).run(USER, `p1b-${USER}@test.local`, "p1b", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "P1BChar");
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

function persistKind(opts: {
  turnStart: number;
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
    inactive: opts.inactive ? true : undefined,
  };
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: opts.turnStart,
    assistantMessageId: null,
    summary: opts.text,
    summaryKind: opts.kind,
    scopePayload: payload,
    branchId: payload.branchId,
    branchStatus: payload.branchStatus,
    promotedBy: payload.promotedBy,
    promotedAt: payload.promotedAt,
    playableTurnCount: opts.turnStart + 40,
  });
  assert.equal(r.ok, true);
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

function mutations(id: number) {
  const raw = (
    getDb()
      .prepare(`SELECT scope_payload FROM chat_turn_summaries WHERE id=?`)
      .get(id) as { scope_payload: string | null }
  ).scope_payload;
  return parseScopePayload(raw)?.branchControlMutations ?? [];
}

/** Greeting + N playable turns; last user message is continue by default. */
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

beforeEach(() => {
  seed();
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
});

after(() => {
  cleanup();
});

describe("selectLatestContiguousNoncanonRecordIds (P1-B helper)", () => {
  it("stops at main_canon and returns only latest segment", () => {
    const a = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    persistKind({ turnStart: 7, kind: "main_canon", text: TEXT_MAIN });
    const b = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B });
    assert.deepEqual(
      selectLatestContiguousNoncanonRecordIds(listMemoryRecordsForChat(CHAT)),
      [b]
    );
    void a;
  });

  it("skips preference and empty_ooc inside a group", () => {
    const b1 = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_B1 });
    persistKind({ turnStart: 7, kind: "preference", text: TEXT_PREF });
    persistKind({ turnStart: 13, kind: "empty_ooc", text: "__SUMMARY_KIND_OOC_ONLY__" });
    const b2 = persistKind({ turnStart: 19, kind: "noncanon", text: TEXT_B2 });
    assert.deepEqual(
      selectLatestContiguousNoncanonRecordIds(listMemoryRecordsForChat(CHAT)),
      [b1, b2]
    );
  });

  it("ignores inactive rows for membership and boundaries", () => {
    const liveOld = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_A });
    persistKind({
      turnStart: 7,
      kind: "noncanon",
      text: "비정사 DEAD: 비활성 행은 무시된다.",
      inactive: true,
    });
    persistKind({ turnStart: 13, kind: "main_canon", text: TEXT_MAIN });
    const b = persistKind({ turnStart: 19, kind: "noncanon", text: TEXT_B });
    assert.deepEqual(
      selectLatestContiguousNoncanonRecordIds(listMemoryRecordsForChat(CHAT)),
      [b]
    );
    assert.equal(row(liveOld).summaryKind, "noncanon");
  });
});

describe("P1-B seal-time narrow noncanon promotion", () => {
  it("LEGACY-FAIL-A reproduced as FIXED: A/main/B/main/C → C only", async () => {
    const idA = persistKind({
      turnStart: 1,
      kind: "noncanon",
      text: TEXT_A,
    });
    persistKind({ turnStart: 7, kind: "main_canon", text: TEXT_MAIN });
    const idB = persistKind({
      turnStart: 13,
      kind: "noncanon",
      text: TEXT_B,
    });
    persistKind({ turnStart: 19, kind: "main_canon", text: TEXT_MAIN });
    const idC = persistKind({
      turnStart: 25,
      kind: "noncanon",
      text: TEXT_C,
    });

    seedPlayableTurns(36, (t) =>
      t === 36
        ? { user: "계속", assistant: "카페 IF가 이어진다." }
        : { user: `(OOC: IF 비트 ${t})`, assistant: `장면 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({
      text: "본편 요약은 사용되지 않을 수 있음.",
    }));

    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );

    assert.equal(row(idA).summaryKind, "noncanon");
    assert.equal(row(idB).summaryKind, "noncanon");
    assert.equal(row(idC).summaryKind, "branch_canon");
    assert.ok(row(idC).branchId);
    assert.equal(row(idA).branchId, null);
    assert.equal(row(idB).branchId, null);
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /카페 IF/);
    assert.doesNotMatch(lore, /회사 IF|학교 배경 IF/);
  });

  it("A1-A3/main/B1-B2 → B1+B2 only", async () => {
    const a1 = persistKind({ turnStart: 1, kind: "noncanon", text: `${TEXT_A} 1` });
    const a2 = persistKind({ turnStart: 7, kind: "noncanon", text: `${TEXT_A} 2` });
    const a3 = persistKind({ turnStart: 13, kind: "noncanon", text: `${TEXT_A} 3` });
    persistKind({ turnStart: 19, kind: "main_canon", text: TEXT_MAIN });
    const b1 = persistKind({ turnStart: 25, kind: "noncanon", text: TEXT_B1 });
    const b2 = persistKind({ turnStart: 31, kind: "noncanon", text: TEXT_B2 });

    seedPlayableTurns(42, (t) =>
      t === 42
        ? { user: "이어서", assistant: "학교 IF 계속." }
        : { user: `(OOC: 비트 ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));

    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );

    assert.equal(row(a1).summaryKind, "noncanon");
    assert.equal(row(a2).summaryKind, "noncanon");
    assert.equal(row(a3).summaryKind, "noncanon");
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.equal(row(b1).branchId, row(b2).branchId);
  });

  it("B1/preference/B2 → B1+B2 promoted; preference untouched", async () => {
    const b1 = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_B1 });
    const pref = persistKind({
      turnStart: 7,
      kind: "preference",
      text: TEXT_PREF,
    });
    const b2 = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B2 });
    seedPlayableTurns(24, (t) =>
      t === 24
        ? { user: "계속", assistant: "이어감." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.equal(row(pref).summaryKind, "preference");
    assert.equal(row(b1).branchId, row(b2).branchId);
  });

  it("B1/empty_ooc/B2 → B1+B2 promoted; empty_ooc untouched", async () => {
    const b1 = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_B1 });
    const ooc = persistKind({
      turnStart: 7,
      kind: "empty_ooc",
      text: "__SUMMARY_KIND_OOC_ONLY__",
    });
    const b2 = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B2 });
    seedPlayableTurns(24, (t) =>
      t === 24
        ? { user: "계속", assistant: "이어감." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.equal(row(ooc).summaryKind, "empty_ooc");
  });

  it("E: active C + unrelated B → B promotion 0; C only in LTM", async () => {
    const idC = persistKind({
      turnStart: 1,
      kind: "branch_canon",
      text: TEXT_BRANCH_C,
      branchId: "branch-C",
      branchStatus: "active",
    });
    const idB = persistKind({
      turnStart: 7,
      kind: "noncanon",
      text: TEXT_B,
    });
    seedPlayableTurns(18, (t) =>
      t >= 13
        ? { user: "계속", assistant: "분기C 이어감." }
        : { user: `분기 비트 ${t}`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(idC).branchId, "branch-C");
    assert.equal(row(idC).branchStatus, "active");
    assert.equal(row(idB).summaryKind, "noncanon");
    assert.equal(row(idB).branchId, null);
    assert.equal(mutations(idB).length, 0);
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
    const batch3 = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 13)!;
    assert.equal(batch3.branchId, "branch-C");
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /분기C|활성 분기|계약 장면/);
    assert.doesNotMatch(lore, /학교 배경 IF/);
  });

  it("F: closed A + B1/B2 + bare 계속 → B only; A stays closed", async () => {
    const idA = persistKind({
      turnStart: 1,
      kind: "branch_canon",
      text: TEXT_BRANCH_A,
      branchId: "branch-A",
      branchStatus: "closed",
    });
    const b1 = persistKind({ turnStart: 7, kind: "noncanon", text: TEXT_B1 });
    const b2 = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B2 });
    seedPlayableTurns(24, (t) =>
      t === 24
        ? { user: "계속", assistant: "새 분기." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(idA).branchStatus, "closed");
    assert.equal(row(idA).summaryKind, "branch_canon");
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.notEqual(row(b1).branchId, "branch-A");
    assert.equal(row(b1).branchId, row(b2).branchId);
  });

  it("G: B1/B2/B3 all promoted with same branch_id", async () => {
    const b1 = persistKind({ turnStart: 1, kind: "noncanon", text: TEXT_B1 });
    const b2 = persistKind({ turnStart: 7, kind: "noncanon", text: TEXT_B2 });
    const b3 = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B3 });
    seedPlayableTurns(24, (t) =>
      t === 24
        ? { user: "계속", assistant: "이어감." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.equal(row(b3).summaryKind, "branch_canon");
    assert.equal(row(b1).branchId, row(b2).branchId);
    assert.equal(row(b2).branchId, row(b3).branchId);
  });

  it("H: continue delete rolls back only selected promote group", async () => {
    const idA = persistKind({
      turnStart: 1,
      kind: "noncanon",
      text: TEXT_A,
    });
    persistKind({ turnStart: 7, kind: "main_canon", text: TEXT_MAIN });
    const b1 = persistKind({ turnStart: 13, kind: "noncanon", text: TEXT_B1 });
    const b2 = persistKind({ turnStart: 19, kind: "noncanon", text: TEXT_B2 });
    seedPlayableTurns(30, (t) =>
      t === 30
        ? { user: "계속", assistant: "B 이어감." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    const continueId = (
      getDb()
        .prepare(
          `SELECT id FROM messages WHERE chat_id=? AND role='user' AND content=? ORDER BY id DESC LIMIT 1`
        )
        .get(CHAT, "계속") as { id: number }
    ).id;
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(b1).summaryKind, "branch_canon");
    assert.equal(row(b2).summaryKind, "branch_canon");
    assert.equal(row(idA).summaryKind, "noncanon");
    assert.equal(mutations(b1).length, 1);
    assert.equal(mutations(b1)[0]!.action, "promote_branch");
    assert.equal(mutations(b1)[0]!.sourceUserMessageId, continueId);

    getDb().prepare("DELETE FROM messages WHERE id=?").run(continueId);
    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(
      CHAT,
      continueId
    );
    assert.ok(rolled >= 2);
    assert.equal(row(b1).summaryKind, "noncanon");
    assert.equal(row(b2).summaryKind, "noncanon");
    assert.equal(row(idA).summaryKind, "noncanon");
    assert.equal(row(idA).branchId, null);
  });

  it("I: inactive noncanon ignored in group selection", async () => {
    persistKind({
      turnStart: 1,
      kind: "noncanon",
      text: "비정사 INACTIVE: 최신처럼 보이지만 비활성이다.",
      inactive: true,
    });
    persistKind({ turnStart: 7, kind: "main_canon", text: TEXT_MAIN });
    const live = persistKind({
      turnStart: 13,
      kind: "noncanon",
      text: TEXT_B,
    });
    persistKind({
      turnStart: 19,
      kind: "noncanon",
      text: "비정사 INACTIVE2: 그룹 안의 비활성 행이다.",
      inactive: true,
    });
    seedPlayableTurns(30, (t) =>
      t === 30
        ? { user: "계속", assistant: "이어감." }
        : { user: `(OOC: IF ${t})`, assistant: `응답 ${t}` }
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await processRollingSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
      }),
      true
    );
    assert.equal(row(live).summaryKind, "branch_canon");
    const inactiveRows = listMemoryRecordsForChat(CHAT).filter((r) => r.inactive);
    for (const r of inactiveRows) {
      assert.equal(r.summaryKind, "noncanon");
      assert.equal(r.branchId, null);
    }
  });

  it("J: regen does not broadly promote unrelated prior noncanon", async () => {
    const old = persistKind({
      turnStart: 1,
      kind: "noncanon",
      text: TEXT_A,
    });
    persistKind({ turnStart: 7, kind: "main_canon", text: TEXT_MAIN });
    const existing = persistKind({
      turnStart: 13,
      kind: "branch_canon",
      text: TEXT_BRANCH_C,
      branchId: "branch-X",
      branchStatus: "active",
    });
    seedPlayableTurns(18, (t) =>
      t === 18
        ? { user: "계속", assistant: "분기 유지." }
        : { user: `비트 ${t}`, assistant: `응답 ${t}` }
    );
    updateChatMemory(CHAT, USER, CHAR, {
      message_count: 18,
      summarized_turn_count: 18,
      membership_tier: "free",
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "x" }));
    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "P1BChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 13,
      }),
      true
    );
    assert.equal(row(old).summaryKind, "noncanon");
    assert.equal(row(old).branchId, null);
    assert.equal(row(existing).branchId, "branch-X");
    assert.equal(row(existing).branchStatus, "active");
  });
});
