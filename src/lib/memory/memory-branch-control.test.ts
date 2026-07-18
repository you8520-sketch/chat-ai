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
import { after, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  rollbackBranchControlMutationsForDeletedUserMessage,
} from "./memory-branch-control";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { reconcileMemoryAfterTurnDelete } from "./memory-reconcile";
import {
  encodeScopePayload,
  parseScopePayload,
  type ScopePayloadV1,
} from "./memory-summary-scope";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  adoptBranchToMainCanon,
  closeActiveBranchCanon,
  listMemoryRecordsForChat,
  promoteRecordsToBranchCanon,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";

const CHAT = 920801;
const USER = 920891;
const CHAR = 920818;

const NONCANON_TEXT =
  "비정사 IF: 현대 회사 배경에서 두 사람이 같은 팀에 배정되고 야근 중 오해를 풀었다.";
const BRANCH_TEXT =
  "분기: 현대 회사 IF가 이어지며 계약서에 서명하기 직전까지 진행됐다.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedChat() {
  const db = getDb();
  cleanup();
  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`
  ).run(USER, `branch-ctrl-${USER}@test.local`, "branch-ctrl", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "BranchCtrl");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`
  ).run(CHAT, USER, CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function insertMsg(role: "user" | "assistant", content: string): number {
  const info = getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`
    )
    .run(CHAT, role, content);
  return Number(info.lastInsertRowid);
}

/** Ensure playable turn count keeps complete batches from being pruned. */
function seedPlayableTurns(count: number, opts?: { firstUser?: string }) {
  getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  for (let t = 1; t <= count; t++) {
    const user =
      t === 1 && opts?.firstUser
        ? opts.firstUser
        : t === count
          ? `마지막 턴 ${t}`
          : `본편 턴 ${t}`;
    insertMsg("user", user);
    insertMsg("assistant", `응답 ${t}`);
  }
}

function persistNoncanonBatch1(): number {
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { noncanon: NONCANON_TEXT },
  };
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: 1,
    assistantMessageId: null,
    summary: NONCANON_TEXT,
    summaryKind: "noncanon",
    scopePayload: payload,
    playableTurnCount: 13,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("persist batch1 failed");
  return r.record.id;
}

function persistBranchBatch2(opts?: {
  branchStatus?: "active" | "closed";
  playableTurnCount?: number;
}): number {
  const payload: ScopePayloadV1 = {
    v: 1,
    scopes: { branch_canon: BRANCH_TEXT },
    branchId: `branch-${CHAT}-7`,
    branchStatus: opts?.branchStatus ?? "active",
    promotedBy: "user_continue",
    promotedAt: new Date().toISOString(),
  };
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: 7,
    assistantMessageId: null,
    summary: BRANCH_TEXT,
    summaryKind: "branch_canon",
    scopePayload: payload,
    branchId: payload.branchId,
    branchStatus: payload.branchStatus,
    promotedBy: payload.promotedBy,
    promotedAt: payload.promotedAt,
    playableTurnCount: opts?.playableTurnCount ?? 13,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("persist batch2 failed");
  return r.record.id;
}

function rowPayload(recordId: number): ScopePayloadV1 | null {
  const row = getDb()
    .prepare(`SELECT scope_payload FROM chat_turn_summaries WHERE id=?`)
    .get(recordId) as { scope_payload: string | null } | undefined;
  return parseScopePayload(row?.scope_payload);
}

function loadRow(recordId: number) {
  return listMemoryRecordsForChat(CHAT).find((r) => r.id === recordId)!;
}

beforeEach(() => {
  seedChat();
});

after(() => {
  cleanup();
});

describe("branch-control provenance + last-turn delete rollback", () => {
  it("A: deleted continue rolls back only its own promotion", () => {
    const id1 = persistNoncanonBatch1();
    const continueUserId = insertMsg("user", "계속");
    insertMsg("assistant", "이어지는 IF 장면입니다.");

    const n = promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-7`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueUserId,
        sourceTurn: 12,
        sourceBatchStart: 7,
      },
    });
    assert.equal(n, 1);
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");
    assert.ok(loadRow(id1).scopes.branch_canon);
    assert.equal(loadRow(id1).scopes.noncanon, undefined);

    // Incomplete batch-2 summary that would be pruned after deleting last turns.
    persistBranchBatch2({ playableTurnCount: 13 });
    // Simulate last-turn delete: remove continue turn messages, leave 11 turns.
    getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
    for (let t = 1; t <= 11; t++) {
      insertMsg("user", t === 1 ? "(OOC: 현대 회사 IF)" : `본편 턴 ${t}`);
      insertMsg("assistant", `응답 ${t}`);
    }

    const ok = reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BranchCtrl",
      tier: "free",
      memoryCapacity: 8000,
      deletedUserMessageId: continueUserId,
      deletedPlayableTurn: 12,
    });
    assert.equal(ok, true);

    const restored = loadRow(id1);
    assert.equal(restored.summaryKind, "noncanon");
    assert.ok(restored.scopes.noncanon);
    assert.equal(restored.scopes.branch_canon, undefined);
    assert.equal(restored.branchId, null);
    assert.equal(restored.branchStatus, null);
    assert.equal(restored.promotedBy, null);

    // Batch 2 pruned (turnEnd 12 > actual 11)
    assert.equal(
      listMemoryRecordsForChat(CHAT).some((r) => r.turnStart === 7),
      false
    );

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, /분기:|branch-/i);
    assert.doesNotMatch(lore, /비정사 IF/);

    const mem = getDb()
      .prepare("SELECT summarized_turn_count, recent_summary FROM chat_memories WHERE chat_id=?")
      .get(CHAT) as { summarized_turn_count: number; recent_summary: string };
    assert.equal(mem.summarized_turn_count, 6);
  });

  it("UI continue is not rolled back by message deletion", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6);
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-ui`,
      promotedBy: "user_ui_continue",
      control: { source: "ui" },
    });
    const unrelatedDeleteId = insertMsg("user", "본편으로 돌아가자");
    insertMsg("assistant", "알겠어.");
    getDb().prepare("DELETE FROM messages WHERE id=?").run(unrelatedDeleteId);

    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(
      CHAT,
      unrelatedDeleteId
    );
    assert.equal(rolled, 0);
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");
    assert.equal(rowPayload(id1)?.branchControlMutations?.[0]?.source, "ui");
  });

  it("B: unrelated old continue text must not block exact promote_branch rollback", () => {
    const id1 = persistNoncanonBatch1();
    // Past continue text — not the provenance of the current promotion.
    const unrelatedOldContinue = insertMsg("user", "계속");
    insertMsg("assistant", "과거 계속(무관).");
    for (let t = 1; t <= 6; t++) {
      insertMsg("user", t === 1 ? "(OOC: 현대 회사 IF)" : `본편 턴 ${t}`);
      insertMsg("assistant", `응답 ${t}`);
    }
    const newContinueId = insertMsg("user", "계속");
    insertMsg("assistant", "최신 계속으로 승격.");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-a`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: newContinueId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.notEqual(newContinueId, unrelatedOldContinue);

    getDb().prepare("DELETE FROM messages WHERE id=?").run(newContinueId);
    assert.ok(
      getDb().prepare("SELECT id FROM messages WHERE id=?").get(unrelatedOldContinue)
    );

    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(
      CHAT,
      newContinueId
    );
    assert.equal(rolled, 1);
    assert.equal(loadRow(id1).summaryKind, "noncanon");
    assert.ok(loadRow(id1).scopes.noncanon);
    assert.equal(loadRow(id1).scopes.branch_canon, undefined);
  });

  it("B: deleted close restores prior active status", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6, { firstUser: "(OOC: 현대 회사 IF)" });
    const continueUserId = insertMsg("user", "계속");
    insertMsg("assistant", "분기 유지");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-7`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueUserId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    const closeId = insertMsg("user", "본편으로 돌아가자");
    const closeAsst = insertMsg("assistant", "본편으로.");
    assert.equal(
      closeActiveBranchCanon(CHAT, {
        source: "user_turn",
        sourceUserMessageId: closeId,
        sourceTurn: 8,
        sourceBatchStart: 7,
      }),
      1
    );
    assert.equal(loadRow(id1).branchStatus, "closed");

    // Delete the close turn messages before reconcile (as DELETE /api/chat/turn does).
    getDb().prepare("DELETE FROM messages WHERE id IN (?,?)").run(closeId, closeAsst);

    const ok = reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BranchCtrl",
      tier: "free",
      memoryCapacity: 8000,
      deletedUserMessageId: closeId,
      deletedPlayableTurn: 8,
    });
    assert.equal(ok, true);
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");

    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /비정사 IF|현대 회사/);
  });

  it("UI close is not rolled back", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6);
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-ui`,
      promotedBy: "user_ui_continue",
      control: { source: "ui" },
    });
    closeActiveBranchCanon(CHAT, { source: "ui" });
    assert.equal(loadRow(id1).branchStatus, "closed");

    const fakeDelete = insertMsg("user", "본편으로 돌아가자");
    getDb().prepare("DELETE FROM messages WHERE id=?").run(fakeDelete);

    assert.equal(rollbackBranchControlMutationsForDeletedUserMessage(CHAT, fakeDelete), 0);
    assert.equal(loadRow(id1).branchStatus, "closed");
  });

  it("A: unrelated old close text must not block exact close_branch rollback", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6, { firstUser: "(OOC: 현대 회사 IF)" });
    const oldCloseId = insertMsg("user", "본편으로 돌아가자");
    insertMsg("assistant", "과거 close(무관).");
    const continueId = insertMsg("user", "계속");
    insertMsg("assistant", "ok");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-x`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    assert.equal(loadRow(id1).branchStatus, "active");
    const newCloseId = insertMsg("user", "본편으로 돌아가자");
    insertMsg("assistant", "최신 close.");
    closeActiveBranchCanon(CHAT, {
      source: "user_turn",
      sourceUserMessageId: newCloseId,
      sourceTurn: 9,
      sourceBatchStart: 7,
    });
    assert.equal(loadRow(id1).branchStatus, "closed");
    assert.notEqual(newCloseId, oldCloseId);

    getDb().prepare("DELETE FROM messages WHERE id=?").run(newCloseId);
    assert.ok(getDb().prepare("SELECT id FROM messages WHERE id=?").get(oldCloseId));

    assert.equal(rollbackBranchControlMutationsForDeletedUserMessage(CHAT, newCloseId), 1);
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");
  });

  it("C: stacked continue→close — delete close pops only close; promote remains", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6, { firstUser: "(OOC: 현대 회사 IF)" });
    const continueId = insertMsg("user", "계속");
    insertMsg("assistant", "ok");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-stack`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    const closeId = insertMsg("user", "본편으로 돌아가자");
    const closeAsst = insertMsg("assistant", "닫음");
    closeActiveBranchCanon(CHAT, {
      source: "user_turn",
      sourceUserMessageId: closeId,
      sourceTurn: 8,
      sourceBatchStart: 7,
    });

    const stack = rowPayload(id1)?.branchControlMutations ?? [];
    assert.equal(stack.length, 2);
    assert.equal(stack[0]!.action, "promote_branch");
    assert.equal(stack[1]!.action, "close_branch");

    getDb().prepare("DELETE FROM messages WHERE id IN (?,?)").run(closeId, closeAsst);

    const rolled = rollbackBranchControlMutationsForDeletedUserMessage(CHAT, closeId);
    assert.equal(rolled, 1);
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");
    const after = rowPayload(id1)?.branchControlMutations ?? [];
    assert.equal(after.length, 1);
    assert.equal(after[0]!.action, "promote_branch");
    assert.equal(after[0]!.sourceUserMessageId, continueId);
  });

  it("D: UI close on top is not rolled back when earlier user_turn message is deleted", () => {
    const id1 = persistNoncanonBatch1();
    seedPlayableTurns(6, { firstUser: "(OOC: 현대 회사 IF)" });
    const continueId = insertMsg("user", "계속");
    insertMsg("assistant", "ok");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-ui-override`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 7,
        sourceBatchStart: 7,
      },
    });
    closeActiveBranchCanon(CHAT, { source: "ui" });
    assert.equal(loadRow(id1).branchStatus, "closed");
    const stack = rowPayload(id1)?.branchControlMutations ?? [];
    assert.equal(stack[stack.length - 1]!.source, "ui");
    assert.equal(stack[stack.length - 1]!.action, "close_branch");

    getDb().prepare("DELETE FROM messages WHERE id=?").run(continueId);
    assert.equal(rollbackBranchControlMutationsForDeletedUserMessage(CHAT, continueId), 0);
    assert.equal(loadRow(id1).branchStatus, "closed");
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
  });

  it("source batch prune + summarized_turn_count + no duplicate rows (6→5)", () => {
    persistNoncanonBatch1();
    persistBranchBatch2({ playableTurnCount: 13 });
    updateChatMemory(CHAT, USER, CHAR, {
      message_count: 12,
      summarized_turn_count: 12,
      membership_tier: "free",
    });

    // 11 playable turns remain → batch 7~12 must prune; no 5-turn partial.
    for (let t = 1; t <= 11; t++) {
      insertMsg("user", `턴 ${t}`);
      insertMsg("assistant", `응답 ${t}`);
    }
    const deletedUser = 999001;
    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BranchCtrl",
      tier: "free",
      memoryCapacity: 8000,
      deletedUserMessageId: deletedUser,
      deletedPlayableTurn: 12,
    });

    const rows = listMemoryRecordsForChat(CHAT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.turnStart, 1);
    const mem = getDb()
      .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT) as { summarized_turn_count: number };
    assert.equal(mem.summarized_turn_count, 6);
  });

  it("legacy scope_payload without mutations still decodes", () => {
    const payload = encodeScopePayload({
      v: 1,
      scopes: { main_canon: "본편 요약" },
    });
    const parsed = parseScopePayload(payload);
    assert.ok(parsed);
    assert.equal(parsed!.branchControlMutations, undefined);
    assert.equal(parseScopePayload("{not json"), null);
    assert.equal(parseScopePayload('{"v":2,"scopes":{}}'), null);
  });
});

describe("C: main-adopt last-turn DELETE fixture (report only)", () => {
  it("seal-style main_adopt does not leave stale cross-row prior adoption after source batch prune", () => {
    /**
     * Seal-time main_adopt only rewrites the sealing batch scopes
     * (composeBatchScopePayload) — it does not call adoptBranchToMainCanon
     * on prior rows. UI adopt is separate (source=ui path).
     *
     * Fixture mirrors DELETE /api/chat/turn:
     * active branch batch1 + adopt batch2 sealed → delete until batch2 pruned.
     */
    const id1 = persistNoncanonBatch1();
    const continueId = insertMsg("user", "계속");
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [id1],
      branchId: `branch-${CHAT}-adopt`,
      promotedBy: "user_continue",
      control: {
        source: "user_turn",
        sourceUserMessageId: continueId,
        sourceTurn: 8,
        sourceBatchStart: 7,
      },
    });

    // Batch 2 sealed as main_canon via adopt wording (same-batch mutation only).
    const adoptText =
      "본편 확정: 현대 회사 IF 내용을 현재 타임라인으로 합친 요약입니다. " +
      "레온과 렌은 사무실에서 오해를 풀고 계약을 진행했으며 이후 본편 관계에도 반영된다.";
    const adoptPayload: ScopePayloadV1 = {
      v: 1,
      scopes: { main_canon: adoptText },
      branchId: `branch-${CHAT}-adopt`,
      branchStatus: "closed",
      promotedBy: "user_main_adopt",
      promotedAt: new Date().toISOString(),
    };
    const r2 = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 7,
      assistantMessageId: null,
      summary: adoptText,
      summaryKind: "main_canon",
      scopePayload: adoptPayload,
      branchId: adoptPayload.branchId,
      branchStatus: "closed",
      promotedBy: "user_main_adopt",
      promotedAt: adoptPayload.promotedAt,
      playableTurnCount: 13,
    });
    assert.equal(r2.ok, true);

    // Prior row stays branch_canon (no cross-row adopt mutation on seal path).
    assert.equal(loadRow(id1).summaryKind, "branch_canon");
    assert.equal(loadRow(id1).branchStatus, "active");

    // Delete last turns so playable count drops below batch2 end → prune batch2.
    getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
    for (let t = 1; t <= 11; t++) {
      insertMsg("user", t === 8 ? "이걸 본편으로 확정" : `턴 ${t}`);
      insertMsg("assistant", `응답 ${t}`);
    }
    // Remove the adopt turn itself (last-turn delete semantics for the adopt message).
    const adoptUserId = getDb()
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='user' AND content=?`
      )
      .get(CHAT, "이걸 본편으로 확정") as { id: number };
    getDb()
      .prepare("DELETE FROM messages WHERE chat_id=? AND id>=?")
      .run(CHAT, adoptUserId.id);

    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BranchCtrl",
      tier: "free",
      memoryCapacity: 8000,
      deletedUserMessageId: adoptUserId.id,
      deletedPlayableTurn: 12,
    });

    const rows = listMemoryRecordsForChat(CHAT);
    assert.equal(
      rows.some((r) => r.turnStart === 7),
      false,
      "source adopt batch must be pruned"
    );
    // Prior branch row was never main_adopted by seal — still branch, not stale main_canon.
    const prior = rows.find((r) => r.id === id1)!;
    assert.equal(prior.summaryKind, "branch_canon");
    assert.notEqual(prior.summaryKind, "main_canon");
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, /본편 확정/);

    // Explicit UI adopt path (for contrast): mutates the targeted row only.
    seedChat();
    const idUi = persistNoncanonBatch1();
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [idUi],
      branchId: `branch-${CHAT}-ui-adopt`,
      promotedBy: "user_ui_continue",
      control: { source: "ui" },
    });
    assert.ok(
      adoptBranchToMainCanon({
        chatId: CHAT,
        recordId: idUi,
        promotedBy: "user",
      })
    );
    assert.equal(loadRow(idUi).summaryKind, "main_canon");
    // No provenance stack for UI adopt in this task — deletion fixture for seal path is PASS.
    console.info(
      "[main-adopt fixture] PASS: seal main_adopt does not cross-row mutate prior records; " +
        "source batch prune removes adopt content; no stale main_canon adoption left on prior rows."
    );
  });
});
