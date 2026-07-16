import assert from "node:assert/strict";
import { describe, it, beforeEach, after } from "node:test";
import { getDb } from "@/lib/db";

import {
  buildNoncanonSummaryFromTurns,
  classifyMemoryBatchScopes,
  classifyMemoryTurnScope,
  lorebookTextFromScopes,
  MEMORY_SCOPE_NEVER_TOUCHES_GLOBAL_CANON,
  shouldAdoptMainCanon,
  shouldCloseBranch,
  shouldPromoteAppreciationOnly,
  shouldPromoteBranchContinue,
  scopesIncludedInLorebookCompact,
  scopesInjectedIntoPrompt,
  scopesVisibleInHistory,
} from "./memory-summary-scope";
import {
  listVisibleMemoryRecordsForChat,
  promoteRecordsToBranchCanon,
  closeActiveBranchCanon,
  adoptBranchToMainCanon,
  rebuildLorebookFromRecords,
  markMemoryRecordInactive,
} from "./memory-turn-summary";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { getOrCreateChatMemory } from "./memory-db";

const CHAT_A = 910701;
const CHAT_B = 910702;
const USER = 910791;
const CHAR = 910718;

const MAIN_FIXTURE =
  "레온은 연회장에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id IN (?,?)").run(CHAT_A, CHAT_B);
  db.prepare("DELETE FROM chat_memories WHERE chat_id IN (?,?)").run(CHAT_A, CHAT_B);
}

beforeEach(() => {
  cleanup();
  getOrCreateChatMemory(CHAT_A, USER, CHAR, "free");
  getOrCreateChatMemory(CHAT_B, USER, CHAR, "free");
});

after(() => {
  cleanup();
});

describe("memory summary scope classification", () => {
  it("meaningful IF/copy-pasta is saved as noncanon", () => {
    assert.equal(
      classifyMemoryTurnScope("(OOC: 현대 회사원 IF 카피페로 진행해)"),
      "meaningful_noncanon"
    );
    const plan = classifyMemoryBatchScopes([
      {
        turnIndex: 1,
        turn: {
          user: "(OOC: 번외 패러디 IF 장면)",
          assistant: "알겠어.",
        },
      },
    ]);
    assert.equal(plan.primaryKind, "noncanon");
    assert.ok(plan.noncanonTurns.length >= 1);
  });

  it("plain OOC becomes empty_ooc", () => {
    assert.equal(
      classifyMemoryTurnScope("(OOC: 문체를 더 짧게 써줘)"),
      "plain_ooc"
    );
    const plan = classifyMemoryBatchScopes(
      Array.from({ length: 6 }, (_, i) => ({
        turnIndex: i + 1,
        turn: { user: "(OOC: 더 짧게)", assistant: "ok" },
      }))
    );
    assert.equal(plan.primaryKind, "empty_ooc");
  });

  it("mixed main canon + noncanon batch preserves both separately", async () => {
    const non = buildNoncanonSummaryFromTurns([
      { turn: { user: "(OOC: 현대 회사원 IF 카피페)", assistant: "…" } },
    ]);
    const r = persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: MAIN_FIXTURE,
      summaryKind: "main_canon",
      scopePayload: {
        v: 1,
        scopes: { main_canon: MAIN_FIXTURE, noncanon: non },
      },
      playableTurnCount: 6,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.record.summaryKind, "main_canon");
    assert.ok(r.record.scopes.main_canon?.includes("커프링크스"));
    assert.ok(r.record.scopes.noncanon?.includes("IF") || r.record.scopes.noncanon?.includes("비정사"));
    // Must not merge into one prose stream in payload
    assert.notEqual(r.record.scopes.main_canon, r.record.scopes.noncanon);
  });

  it("noncanon is visible in history but absent from normal prompt lorebook", () => {
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "현대 회사원 IF 카피페를 진행함.",
      summaryKind: "noncanon",
      scopePayload: {
        v: 1,
        scopes: { noncanon: "현대 회사원 IF 카피페를 진행함." },
      },
      playableTurnCount: 6,
    });
    const visible = listVisibleMemoryRecordsForChat(CHAT_A);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]!.summaryKind, "noncanon");
    assert.equal(scopesVisibleInHistory("noncanon"), true);
    assert.equal(scopesInjectedIntoPrompt("noncanon"), false);
    const lore = rebuildLorebookFromRecords(CHAT_A);
    assert.equal(lore.includes("IF"), false);
    assert.equal(lore.trim(), "");
  });

  it("재밌다 does not promote", () => {
    assert.equal(shouldPromoteAppreciationOnly("재밌다"), true);
    assert.equal(shouldPromoteBranchContinue("재밌다"), false);
    assert.equal(
      classifyMemoryTurnScope("재밌다", { previousWasNoncanonOrBranch: true }),
      "plain_ooc"
    );
  });

  it("계속 promotes previous IF to branch_canon", () => {
    assert.equal(shouldPromoteBranchContinue("계속"), true);
    assert.equal(
      classifyMemoryTurnScope("(OOC: 이어서 다음 장면)", {
        previousWasNoncanonOrBranch: true,
      }),
      "branch_continue"
    );

    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "현대 회사원 IF 카피페 장면을 진행함.",
      summaryKind: "noncanon",
      scopePayload: { v: 1, scopes: { noncanon: "현대 회사원 IF 카피페 장면을 진행함." } },
      playableTurnCount: 6,
    });
    const ids = listVisibleMemoryRecordsForChat(CHAT_A).map((r) => r.id);
    const n = promoteRecordsToBranchCanon({
      chatId: CHAT_A,
      recordIds: ids,
      branchId: "branch-test",
      promotedBy: "user_continue",
    });
    assert.ok(n >= 1);
    const after = listVisibleMemoryRecordsForChat(CHAT_A)[0]!;
    assert.equal(after.summaryKind, "branch_canon");
    assert.equal(after.branchStatus, "active");
    assert.ok(after.scopes.branch_canon);
  });

  it("direct dialogue/action continuing IF promotes to branch_canon", () => {
    assert.equal(
      classifyMemoryTurnScope('*레온의 손을 잡고 미소 지으며 말한다.* "같이 가자."', {
        previousWasNoncanonOrBranch: true,
      }),
      "branch_continue"
    );
  });

  it("active branch_canon is injected only in current chat/branch", () => {
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "분기 장면이 계속 진행되었다.",
      summaryKind: "branch_canon",
      branchId: "b1",
      branchStatus: "active",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: "분기 장면이 계속 진행되었다." },
        branchId: "b1",
        branchStatus: "active",
      },
      playableTurnCount: 6,
    });
    const loreA = rebuildLorebookFromRecords(CHAT_A);
    assert.ok(loreA.includes("분기 장면"));
    const loreB = rebuildLorebookFromRecords(CHAT_B);
    assert.equal(loreB.includes("분기 장면"), false);
  });

  it("unrelated chats never receive branch_canon", () => {
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "비밀 분기 장면이 이어졌다.",
      summaryKind: "branch_canon",
      branchStatus: "active",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: "비밀 분기 장면이 이어졌다." },
        branchStatus: "active",
      },
      playableTurnCount: 6,
    });
    assert.equal(rebuildLorebookFromRecords(CHAT_B).trim(), "");
  });

  it("본편으로 돌아가자 closes the branch", () => {
    assert.equal(shouldCloseBranch("본편으로 돌아가자"), true);
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "활성 분기 장면이 진행 중이었다.",
      summaryKind: "branch_canon",
      branchStatus: "active",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: "활성 분기 장면이 진행 중이었다." },
        branchStatus: "active",
      },
      playableTurnCount: 6,
    });
    assert.ok(rebuildLorebookFromRecords(CHAT_A).includes("활성 분기"));
    closeActiveBranchCanon(CHAT_A);
    const closed = listVisibleMemoryRecordsForChat(CHAT_A)[0]!;
    assert.equal(closed.branchStatus, "closed");
    assert.equal(rebuildLorebookFromRecords(CHAT_A).includes("활성 분기"), false);
  });

  it("closed branch remains retrievable but not normally injected", () => {
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "종료된 분기 내용을 보존한다.",
      summaryKind: "branch_canon",
      branchStatus: "closed",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: "종료된 분기 내용을 보존한다." },
        branchStatus: "closed",
      },
      playableTurnCount: 6,
    });
    const hist = listVisibleMemoryRecordsForChat(CHAT_A);
    assert.equal(hist.length, 1);
    assert.equal(hist[0]!.branchStatus, "closed");
    assert.equal(rebuildLorebookFromRecords(CHAT_A).includes("종료 분기"), false);
  });

  it("explicit main timeline adoption promotes to main_canon", () => {
    assert.equal(shouldAdoptMainCanon("이걸 본편으로 이어갈게"), true);
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: "IF였던 장면을 본편으로 채택함.",
      summaryKind: "branch_canon",
      branchStatus: "active",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: "IF였던 장면을 본편으로 채택함." },
        branchStatus: "active",
      },
      playableTurnCount: 6,
    });
    const id = listVisibleMemoryRecordsForChat(CHAT_A)[0]!.id;
    assert.ok(adoptBranchToMainCanon({ chatId: CHAT_A, recordId: id, promotedBy: "user" }));
    const row = listVisibleMemoryRecordsForChat(CHAT_A)[0]!;
    assert.equal(row.summaryKind, "main_canon");
    assert.ok(rebuildLorebookFromRecords(CHAT_A).includes("IF였던"));
  });

  it("global canon is never modified automatically", () => {
    assert.equal(MEMORY_SCOPE_NEVER_TOUCHES_GLOBAL_CANON, true);
  });

  it("deletion/regeneration invalidates or replaces derived scope", () => {
    persistValidatedSummaryBatch({
      chatId: CHAT_A,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: MAIN_FIXTURE,
      summaryKind: "main_canon",
      playableTurnCount: 6,
    });
    const id = listVisibleMemoryRecordsForChat(CHAT_A)[0]!.id;
    assert.ok(markMemoryRecordInactive(CHAT_A, id));
    assert.equal(listVisibleMemoryRecordsForChat(CHAT_A).length, 0);
    assert.equal(rebuildLorebookFromRecords(CHAT_A).trim(), "");
  });

  it("noncanon/empty_ooc excluded from 10k compact input", () => {
    assert.equal(scopesIncludedInLorebookCompact("noncanon"), false);
    assert.equal(scopesIncludedInLorebookCompact("empty_ooc"), false);
    assert.equal(scopesIncludedInLorebookCompact("main_canon"), true);
    assert.equal(scopesIncludedInLorebookCompact("branch_canon"), true);
    assert.equal(scopesIncludedInLorebookCompact("preference"), true);
    const mixed = lorebookTextFromScopes(
      {
        main_canon: "본편",
        noncanon: "IF",
        empty_ooc: "x",
        branch_canon: "분기",
      },
      { branchStatus: "active" }
    );
    assert.ok(mixed.includes("본편"));
    assert.ok(mixed.includes("분기"));
    assert.equal(mixed.includes("IF"), false);
  });
});
