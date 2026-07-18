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
import { shouldPromoteBranchContinue, type ScopePayloadV1 } from "./memory-summary-scope";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  closeActiveBranchCanon,
  countDistinctActiveBranchIds,
  listDistinctClosedBranchIds,
  listMemoryRecordsForChat,
  promoteRecordsToBranchCanon,
  rebuildLorebookFromRecords,
  reopenClosedBranchCanon,
  resolveSoleClosedContinueReopen,
} from "./memory-turn-summary";
import {
  __setPersistForceFailAfterUpsertForTests,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";

const CHAT = 921901;
const USER = 921991;
const CHAR = 921918;

const TEXT_A = "분기A: 현대 회사 IF에서 두 사람이 계약을 준비했다.";
const TEXT_B = "분기B: 학교 배경 IF에서 시험 전날 대화를 나눴다.";
const TEXT_C = "분기C: 카페 IF가 이어지며 약속을 잡았다.";
const NONCANON_B = "비정사: 최신 번외 장면이 잠깐 진행됐다.";
const MAIN_TEXT =
  "레온은 연회장에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";
const PREF_TEXT = "앞으로 서술 톤은 차분하게 유지.";

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
  ).run(USER, `reopen-${USER}@test.local`, "reopen", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ReopenChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT, USER, CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function persistBranch(opts: {
  turnStart: number;
  branchId: string;
  status: "active" | "closed";
  text: string;
  promotedBy?: string;
}): number {
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { branch_canon: opts.text },
    branchId: opts.branchId,
    branchStatus: opts.status,
    promotedBy: opts.promotedBy ?? "user_continue",
    promotedAt: "2026-01-01T00:00:00.000Z",
  };
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: opts.turnStart,
    assistantMessageId: null,
    summary: opts.text,
    summaryKind: "branch_canon",
    scopePayload: payload,
    branchId: opts.branchId,
    branchStatus: opts.status,
    promotedBy: payload.promotedBy,
    promotedAt: payload.promotedAt,
    playableTurnCount: opts.turnStart + 20,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("persist branch failed");
  return r.record.id;
}

function persistNoncanon(turnStart: number, text: string): number {
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart,
    assistantMessageId: null,
    summary: text,
    summaryKind: "noncanon",
    scopePayload: { v: 1, scopes: { noncanon: text } },
    playableTurnCount: turnStart + 20,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("persist noncanon failed");
  return r.record.id;
}

function persistMain(turnStart: number): number {
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart,
    assistantMessageId: null,
    summary: MAIN_TEXT,
    summaryKind: "main_canon",
    scopePayload: {
      v: 1,
      scopes: { main_canon: MAIN_TEXT, preference: PREF_TEXT },
    },
    playableTurnCount: turnStart + 20,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("persist main failed");
  return r.record.id;
}

function row(id: number) {
  return listMemoryRecordsForChat(CHAT).find((r) => r.id === id)!;
}

function insertMsg(role: "user" | "assistant", content: string): number {
  return Number(
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`)
      .run(CHAT, role, content).lastInsertRowid
  );
}

const CONTINUE_SCENE =
  "회사 IF가 이어지며 두 사람이 계약서에 서명하기 직전 장면을 진행했다. " +
  "오해가 풀리고 다음 만남을 약속하며 분기가 계속된다.";

/** Seed greeting + N playable user+assistant pairs (playable turn numbers 1..N). */
function seedPlayableTurns(
  count: number,
  turnFn: (t: number) => { user: string; assistant: string }
) {
  getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    )
    .run(CHAT, "assistant", "인사.", "greeting");
  for (let t = 1; t <= count; t++) {
    const { user, assistant } = turnFn(t);
    insertMsg("user", user);
    insertMsg("assistant", assistant);
  }
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  __setPersistForceFailAfterUpsertForTests(false);
  __setSummarizeTurnBatchCallerForTests(null);
});

after(() => {
  cleanup();
});

describe("targeted closed branch reopen", () => {
  it("A: reopen closed A only; B stays closed; branch_id stable", () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    const idB = persistBranch({
      turnStart: 7,
      branchId: "branch-B",
      status: "closed",
      text: TEXT_B,
    });

    const result = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: idA,
      source: "ui_reopen",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.branchId, "branch-A");
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idA).branchId, "branch-A");
    assert.equal(row(idB).branchStatus, "closed");
    assert.equal(row(idB).branchId, "branch-B");
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });

  it("B: reopen A closes active C; single active invariant", () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    const idC = persistBranch({
      turnStart: 7,
      branchId: "branch-C",
      status: "active",
      text: TEXT_C,
    });

    const result = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: idA,
      source: "ui_reopen",
    });
    assert.equal(result.ok, true);
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idA).branchId, "branch-A");
    assert.equal(row(idC).branchStatus, "closed");
    assert.equal(row(idC).summary, TEXT_C);
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });

  it("C: same branch_id multi-row reopen from middle record", () => {
    const a1 = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A + " 1",
    });
    const a2 = persistBranch({
      turnStart: 7,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A + " 2",
    });
    const a3 = persistBranch({
      turnStart: 13,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A + " 3",
    });
    persistBranch({
      turnStart: 19,
      branchId: "branch-B",
      status: "closed",
      text: TEXT_B,
    });

    const result = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: a2,
      source: "ui_reopen",
    });
    assert.equal(result.ok, true);
    assert.equal(row(a1).branchStatus, "active");
    assert.equal(row(a2).branchStatus, "active");
    assert.equal(row(a3).branchStatus, "active");
    assert.equal(row(a1).branchId, "branch-A");
    assert.equal(row(a2).branchId, "branch-A");
    assert.equal(row(a3).branchId, "branch-A");
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
    assert.ok(listDistinctClosedBranchIds(CHAT).includes("branch-B"));
  });

  it("D: reopen A leaves noncanon B untouched", () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    const idB = persistNoncanon(7, NONCANON_B);

    reopenClosedBranchCanon({ chatId: CHAT, recordId: idA, source: "ui_reopen" });
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idB).summaryKind, "noncanon");
    assert.equal(row(idB).scopes.noncanon, NONCANON_B);
    assert.equal(row(idB).branchId, null);
  });

  it("E: generic continue + exactly one closed → sole reopen gate", () => {
    persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    assert.equal(shouldPromoteBranchContinue("아까 IF 이어서"), true);
    const sole = resolveSoleClosedContinueReopen({
      hasActiveBranch: false,
      hasNoncanonCandidate: false,
      closedBranchIds: listDistinctClosedBranchIds(CHAT),
      hasContinueIntent: shouldPromoteBranchContinue("아까 IF 이어서"),
    });
    assert.equal(sole, "branch-A");
    const result = reopenClosedBranchCanon({
      chatId: CHAT,
      branchId: sole,
      source: "seal_sole_closed_continue",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.branchId, "branch-A");
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });

  it("F: generic continue + two closed → no guess / no reopen", () => {
    persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    persistBranch({
      turnStart: 7,
      branchId: "branch-B",
      status: "closed",
      text: TEXT_B,
    });
    const sole = resolveSoleClosedContinueReopen({
      hasActiveBranch: false,
      hasNoncanonCandidate: false,
      closedBranchIds: listDistinctClosedBranchIds(CHAT),
      hasContinueIntent: shouldPromoteBranchContinue("아까 IF 이어서"),
    });
    assert.equal(sole, null);
    assert.deepEqual(listDistinctClosedBranchIds(CHAT).sort(), ["branch-A", "branch-B"]);
    assert.equal(countDistinctActiveBranchIds(CHAT), 0);
  });

  it("G: repeated reopen is idempotent", () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
      promotedBy: "user_continue",
    });
    const first = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: idA,
      source: "ui_reopen",
    });
    assert.equal(first.ok, true);
    const before = listMemoryRecordsForChat(CHAT);
    const second = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: idA,
      source: "ui_reopen",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.branchId, "branch-A");
    const after = listMemoryRecordsForChat(CHAT);
    assert.equal(after.length, before.length);
    assert.equal(row(idA).branchId, "branch-A");
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idA).promotedBy, "user_continue");
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });

  it("H: LTM includes only active A; main/preference kept; noncanon excluded", () => {
    persistMain(1);
    const idA = persistBranch({
      turnStart: 7,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    persistBranch({
      turnStart: 13,
      branchId: "branch-B",
      status: "closed",
      text: TEXT_B,
    });
    persistNoncanon(19, NONCANON_B);

    reopenClosedBranchCanon({ chatId: CHAT, recordId: idA, source: "ui_reopen" });
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /분기A/);
    assert.doesNotMatch(lore, /분기B/);
    assert.doesNotMatch(lore, /비정사: 최신 번외/);
    assert.match(lore, /레온은 연회장/);
    assert.match(lore, /차분하게/);
  });

  it("reopen does not append deletion-stack mutations; close rollback still works", () => {
    const idA = persistNoncanon(1, TEXT_A.replace("분기A: ", "비정사 IF: "));
    const continueId = insertMsg("user", "계속");
    insertMsg("assistant", "ok");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [idA],
      branchId: "branch-A",
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    const closeId = insertMsg("user", "본편으로 돌아가자");
    insertMsg("assistant", "닫음");
    closeActiveBranchCanon(CHAT, {
      source: "user_turn",
      sourceUserMessageId: closeId,
      sourceTurn: 8,
      sourceBatchStart: 7,
    });
    assert.equal(row(idA).branchStatus, "closed");

    // UI reopen must not poison the stack with user_turn provenance.
    reopenClosedBranchCanon({ chatId: CHAT, recordId: idA, source: "ui_reopen" });
    assert.equal(row(idA).branchStatus, "active");
    const payload = getDb()
      .prepare(`SELECT scope_payload FROM chat_turn_summaries WHERE id=?`)
      .get(idA) as { scope_payload: string };
    const mutations = JSON.parse(payload.scope_payload).branchControlMutations as Array<{
      action: string;
      source: string;
    }>;
    assert.equal(mutations?.length, 2);
    assert.equal(mutations.every((m) => m.source === "user_turn"), true);

    // Delete close turn → rollback close only (stack top), leave promote.
    getDb().prepare("DELETE FROM messages WHERE id=?").run(closeId);
    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(CHAT, closeId);
    // Already active from reopen; close mutation still on stack — popping restores prior active.
    assert.ok(rolled >= 0);
    assert.equal(row(idA).summaryKind, "branch_canon");
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idA).branchId, "branch-A");
  });

  it("UI continue promote is not rolled back by unrelated message deletion", () => {
    const id = persistNoncanon(1, NONCANON_B);
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id],
      branchId: "branch-ui",
      promotedBy: "user_ui_continue",
      control: { source: "ui" },
    });
    const fake = insertMsg("user", "본편으로 돌아가자");
    getDb().prepare("DELETE FROM messages WHERE id=?").run(fake);
    assert.equal(rollbackBranchControlMutationsForDeletedUserMessage(CHAT, fake), 0);
    assert.equal(row(id).branchStatus, "active");
  });
});

describe("seal-path blockers: atomicity / sole-closed e2e / single-active", () => {
  it("1: sole-closed reopen is atomic — persist fail leaves A closed", async () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });
    updateChatMemory(CHAT, USER, CHAR, {
      recent_summary: "[1~6턴] " + TEXT_A,
      membership_tier: "free",
    });
    getDb()
      .prepare("UPDATE chats SET current_summary=? WHERE id=?")
      .run("[1~6턴] " + TEXT_A, CHAT);
    const loreBefore = (
      getDb()
        .prepare("SELECT current_summary FROM chats WHERE id=?")
        .get(CHAT) as { current_summary: string }
    ).current_summary;

    seedPlayableTurns(12, (t) =>
      t === 12
        ? { user: "아까 IF 이어서", assistant: CONTINUE_SCENE }
        : { user: `본편 턴 ${t}`, assistant: `응답 ${t} — 장면을 짧게 이어간다.` }
    );

    __setPersistForceFailAfterUpsertForTests(true);
    const ok = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "ReopenChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(ok, false);
    assert.equal(row(idA).branchStatus, "closed");
    assert.equal(row(idA).branchId, "branch-A");
    assert.equal(
      listMemoryRecordsForChat(CHAT).some((r) => r.turnStart === 7),
      false
    );
    const loreAfter = (
      getDb()
        .prepare("SELECT current_summary FROM chats WHERE id=?")
        .get(CHAT) as { current_summary: string }
    ).current_summary;
    assert.equal(loreAfter, loreBefore);
    assert.equal(countDistinctActiveBranchIds(CHAT), 0);
  });

  it("2: sole-closed continue e2e via processRollingSummaryBatch", async () => {
    const idA = persistBranch({
      turnStart: 1,
      branchId: "branch-A",
      status: "closed",
      text: TEXT_A,
    });

    seedPlayableTurns(12, (t) =>
      t === 12
        ? { user: "계속", assistant: CONTINUE_SCENE }
        : {
            user: `(OOC: IF 이어서 장면 ${t})`,
            assistant: `${CONTINUE_SCENE} 추가 비트 ${t}`,
          }
    );

    // Must not invent main_canon via LLM fall-through.
    __setSummarizeTurnBatchCallerForTests(async () => ({
      text: MAIN_TEXT,
    }));

    const ok = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "ReopenChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(ok, true);
    assert.equal(row(idA).branchStatus, "active");
    assert.equal(row(idA).branchId, "branch-A");

    const batch2 = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 7);
    assert.ok(batch2);
    assert.equal(batch2!.summaryKind, "branch_canon");
    assert.equal(batch2!.branchId, "branch-A");
    assert.equal(batch2!.branchStatus, "active");
    assert.notEqual(batch2!.summaryKind, "main_canon");
    assert.equal(batch2!.branchId?.startsWith(`branch-${CHAT}-`), false);
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /분기A|회사 IF|계약/);
  });

  it("3: seal continue with active C keeps same branch_id (single-active)", async () => {
    const idC = persistBranch({
      turnStart: 1,
      branchId: "branch-C",
      status: "active",
      text: TEXT_C,
    });

    seedPlayableTurns(12, (t) =>
      t >= 10
        ? { user: "이어서", assistant: CONTINUE_SCENE }
        : { user: `분기 이어 ${t}`, assistant: `${TEXT_C} 비트 ${t}` }
    );

    __setSummarizeTurnBatchCallerForTests(async () => ({
      text: MAIN_TEXT,
    }));

    const ok = await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "ReopenChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(ok, true);
    assert.equal(row(idC).branchStatus, "active");
    assert.equal(row(idC).branchId, "branch-C");

    const batch2 = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 7)!;
    assert.equal(batch2.summaryKind, "branch_canon");
    assert.equal(batch2.branchId, "branch-C");
    assert.notEqual(batch2.branchId, `branch-${CHAT}-7`);
    assert.equal(countDistinctActiveBranchIds(CHAT), 1);
  });
});
