/**
 * Synthetic stand-in for a mixed 5-turn batch whose last turn opens a side story.
 * Real RP text stays in the private evidence repo.
 */
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
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import { getDb } from "@/lib/db";
import { getEpisodicMemoryForPrompt } from "@/lib/episodicMemoryFacts";
import { resolveOocSceneRenderIntent } from "@/lib/oocSceneRender";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { getChatMemoryRow, getOrCreateChatMemory } from "./memory-db";
import { reconcileMemoryAfterTurnDelete } from "./memory-reconcile";
import { resolveEpisodicEligibilityForSourceUserMessage } from "./memory-episodic-eligibility";
import {
  parseSharedEpisodicSection,
  reconcileSharedEpisodicFactsForTurn,
  shouldRequestEpisodicInSharedInitial,
} from "./memory-episodic-shared";
import type { EpisodicExtractedFact } from "./memory-episodic-types";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";
import {
  classifyMemoryBatchScopes,
  classifyMemoryTurnScope,
  isExplicitClosedBranchContinueIntent,
  parseScopePayload,
  resolveEpisodicTurnEligibility,
  resolveSealedNoncanonOrBranchFromMemoryRecords,
  resolveSharedPreviousBranchState,
} from "./memory-summary-scope";
import { loadMemoryEligibleChatTurnsWithMessageIds } from "./memory-turn-loader";
import {
  closeActiveBranchCanon,
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  reopenClosedBranchCanon,
} from "./memory-turn-summary";

const CHAT = 961410;
const USER = 961411;
const CHAR = 961412;
const ADOPT_CHAT = 961420;
const ADOPT_USER = 961421;
const ADOPT_CHAR = 961422;

const MAIN_USER = "내일 정오에 청동 열쇠를 가져오겠다.";
const MAIN_ASSISTANT = "광장에서 청동 열쇠를 정오에 건네기로 약속했다.";
const OPENER = "[OOC: 새 외전을 시작한다. 축제 야시장의 청룡 가면 상인을 만난다.]";
const SIDE_BEAT = '"청룡 가면이 은화를 요구한다." *가면을 집어 든다*';
const SIDE_ASSISTANT = "청룡 가면 상인이 은화를 내밀었다.";
const CLOSE_USER = "본편으로 돌아가자. 이건 여기까지.";
const NEW_MAIN_USER = '"시계탑 아래에서 은방울 서약을 지키겠다." *서약의 끈을 손에 감는다*';
const NEW_MAIN_ASSISTANT = "시계탑 아래에서 은방울 서약을 확인했다.";
const ADOPT_USER_TEXT = "이걸 본편으로 실제 있었던 일로 확정해줘";
const ADOPT_BEAT = '"백금 부채를 집어 든다." *부채를 펼친다*';
const RESUME_BEAT = '"다시 야시장 골목으로 걸어간다." *손을 내민다*';
const RESUME_ASSISTANT = "골목 끝에서 손을 마주 잡았다.";

const KEY_FACT: EpisodicExtractedFact = {
  category: "location",
  subject: "plaza",
  attribute: "bronze_key_marker",
  value: "noon_plaza",
  importance: "important",
  fact_text: "광장에서 청동 열쇠가 정오의 표식이 되었다.",
  evidence_type: "explicit_user_statement",
  evidence: { source_role: "user", source_quote: MAIN_USER },
};

const BELL_FACT: EpisodicExtractedFact = {
  category: "location",
  subject: "clock_tower",
  attribute: "silver_bell_marker",
  value: "clock_tower",
  importance: "important",
  fact_text: "시계탑 아래에서 은방울이 서약의 표식이 되었다.",
  evidence_type: "explicit_user_statement",
  evidence: { source_role: "user", source_quote: NEW_MAIN_USER },
};

const SIDE_FACT: EpisodicExtractedFact = {
  category: "item",
  subject: "merchant",
  attribute: "mask_coin",
  value: "dragon_mask",
  importance: "important",
  fact_text: "청룡 가면 상인이 은화를 요구했다.",
  evidence_type: "explicit_scene_event",
  evidence: { source_role: "user", source_quote: SIDE_BEAT },
};

type StoredTurn = {
  turn: number;
  userId: number;
  assistantId: number;
  user: string;
  assistant: string;
};

function script(turn: number): { user: string; assistant: string } {
  if (turn <= 9) return { user: MAIN_USER, assistant: MAIN_ASSISTANT };
  if (turn === 10) return { user: OPENER, assistant: "청룡 가면 상인이 야시장에 서 있다." };
  if (turn <= 19) return { user: SIDE_BEAT, assistant: SIDE_ASSISTANT };
  if (turn === 20) return { user: CLOSE_USER, assistant: "광장의 본편으로 돌아온다." };
  if (turn <= 25) return { user: NEW_MAIN_USER, assistant: NEW_MAIN_ASSISTANT };
  return { user: "자리를 지킨다.", assistant: "그 자리에 남는다." };
}

function cleanupChat(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare("DELETE FROM characters WHERE id=?").run(charId);
}

function seedChat(chatId: number, userId: number, charId: number, name: string) {
  cleanupChat(chatId, userId, charId);
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    userId,
    `parity-${userId}@test.local`,
    name,
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, name);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  getOrCreateChatMemory(chatId, userId, charId, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "인사.",
    "greeting"
  );
}

function insertTurn(
  chatId: number,
  userText: string,
  assistantText: string
): { userId: number; assistantId: number; turn: number } {
  const db = getDb();
  const userId = Number(
    db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(chatId, "user", userText).lastInsertRowid
  );
  const assistantId = Number(
    db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
      )
      .run(chatId, "assistant", assistantText, "test", userId).lastInsertRowid
  );
  const turn = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE chat_id=? AND role='assistant' AND model!='greeting'`
    )
    .get(chatId) as { c: number };
  return { userId, assistantId, turn: turn.c };
}

function seedScript(count: number): StoredTurn[] {
  const rows: StoredTurn[] = [];
  for (let turn = 1; turn <= count; turn += 1) {
    const pair = script(turn);
    const inserted = insertTurn(CHAT, pair.user, pair.assistant);
    rows.push({ turn, ...inserted, user: pair.user, assistant: pair.assistant });
  }
  return rows;
}

function reconcile(
  chatId: number,
  userId: number,
  characterId: number,
  turn: StoredTurn,
  facts: EpisodicExtractedFact[]
) {
  const parsed = parseSharedEpisodicSection({ extracted_facts: facts });
  return reconcileSharedEpisodicFactsForTurn(getDb(), {
    chatId,
    userId,
    characterId,
    assistantMessageId: turn.assistantId,
    sourceUserMessageId: turn.userId,
    sourceUserText: turn.user,
    episodic: parsed,
  });
}

function rowAt(chatId: number, turnStart: number) {
  const row = listMemoryRecordsForChat(chatId).find((record) => record.turnStart === turnStart);
  assert.ok(row, `missing summary row at ${turnStart}`);
  return row;
}

async function seal(chatId: number, userId: number, characterId: number, charName: string) {
  return processRollingSummaryBatch({
    chatId,
    userId,
    characterId,
    charName,
    tier: "free",
    memoryCapacity: 8000,
  });
}

function lorebook(chatId: number): string {
  return `${getChatMemoryRow(chatId)?.recent_summary ?? ""}\n${rebuildLorebookFromRecords(chatId)}`;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_FEATURE_ENABLED = "1";
  seedChat(CHAT, USER, CHAR, "ParityChar");
  seedChat(ADOPT_CHAT, ADOPT_USER, ADOPT_CHAR, "AdoptChar");
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __setCompactCurrentMemoryTestOverride(null);
  cleanupChat(CHAT, USER, CHAR);
  cleanupChat(ADOPT_CHAT, ADOPT_USER, ADOPT_CHAR);
});

describe("shared branch state", () => {
  it("keeps null, short, and plain OOC from opening a branch", () => {
    assert.equal(classifyMemoryTurnScope(""), "plain_ooc");
    assert.equal(classifyMemoryTurnScope("   "), "plain_ooc");
    assert.equal(classifyMemoryTurnScope("(OOC: 문체를 더 짧게)"), "plain_ooc");
    assert.equal(resolveEpisodicTurnEligibility("(OOC: 문체를 더 짧게)").eligible, false);
    assert.equal(
      resolvePreviousOpen(["", "   ", "(OOC: 문체를 더 짧게)"]),
      false
    );

    const shortLine = "응.";
    const alone = classifyMemoryTurnScope(shortLine, { previousWasNoncanonOrBranch: true });
    const batched = classifyMemoryBatchScopes(
      [{ turnIndex: 1, turn: { user: shortLine, assistant: "응." } }],
      { previousWasNoncanonOrBranch: true }
    );
    assert.equal(batched.classes[0], alone);
    assert.equal(isExplicitClosedBranchContinueIntent("아까 IF 이어서"), true);
  });

  it("reads an open side story from user text when the sealed row is main_canon", () => {
    const sealed = [
      {
        turnStart: 1,
        summaryKind: "main_canon" as const,
        branchStatus: null,
        inactive: false,
      },
    ];
    assert.equal(resolveSealedNoncanonOrBranchFromMemoryRecords(sealed, 6), false);
    assert.equal(
      resolveSharedPreviousBranchState({
        priorUserMessages: [MAIN_USER, OPENER],
        sealedRecords: sealed,
        beforeTurnNumber: 6,
      }),
      true
    );
    assert.equal(
      resolveSharedPreviousBranchState({
        priorUserMessages: [OPENER, CLOSE_USER],
        sealedRecords: [
          {
            turnStart: 1,
            summaryKind: "branch_canon",
            branchStatus: "active",
            inactive: true,
          },
        ],
        beforeTurnNumber: 6,
      }),
      false
    );
  });

  it("mixed last-turn side story stays out of the next main summary and episodic store", async () => {
    assert.equal(resolveOocSceneRenderIntent(OPENER), false);
    assert.equal(classifyMemoryTurnScope(OPENER), "meaningful_noncanon");

    const turns = seedScript(26);
    const loaded = loadMemoryEligibleChatTurnsWithMessageIds(CHAT);
    assert.equal(loaded.length, 26);
    assert.equal(loaded.find((turn) => turn.turnNumber === 10)?.user, OPENER);

    let modelCalls = 0;
    const compactAfterClose: string[] = [];
    let closing = false;
    __setCompactCurrentMemoryTestOverride(async (existing) => {
      if (closing) compactAfterClose.push(existing);
      return existing;
    });
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      modelCalls += 1;
      const content = history[0]?.content ?? "";
      if (content.includes("청룡") || content.includes("은화")) {
        throw new Error("side-story batch must not call the main summarizer");
      }
      const lines = [...content.matchAll(/ParityChar: ([^\n]+)/g)].map((match) => match[1]!.trim());
      let text = lines.join(" ");
      while (text.length < 80) {
        text = `${text} ${lines[0] ?? MAIN_ASSISTANT}`.trim();
      }
      return { text };
    });

    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    const mainRow = rowAt(CHAT, 1);
    assert.equal(mainRow.summaryKind, "main_canon");
    assert.match(lorebook(CHAT), /청동 열쇠/);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);
    const mainTurn = turns[2]!;
    assert.equal(
      resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
        chatId: CHAT,
        sourceUserMessageId: mainTurn.userId,
        sourceUserText: mainTurn.user,
      }).eligible,
      true
    );
    assert.equal(reconcile(CHAT, USER, CHAR, mainTurn, [KEY_FACT]).inserted, 1);

    const callsAfterMain = modelCalls;
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(modelCalls, callsAfterMain + 1);
    const mixed = rowAt(CHAT, 6);
    assert.equal(mixed.summaryKind, "main_canon");
    assert.match(mixed.scopes.noncanon ?? "", /외전|청룡/);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);
    const sealedOnly = listMemoryRecordsForChat(CHAT).some(
      (record) =>
        !record.inactive &&
        (record.summaryKind === "noncanon" ||
          (record.summaryKind === "branch_canon" && record.branchStatus === "active"))
    );
    assert.equal(sealedOnly, false);
    const priorUsers = loaded.filter((turn) => turn.turnNumber < 11).map((turn) => turn.user);
    assert.equal(
      resolveSharedPreviousBranchState({
        priorUserMessages: priorUsers,
        sealedRecords: listMemoryRecordsForChat(CHAT).map((record) => ({
          turnStart: record.turnStart,
          summaryKind: record.summaryKind,
          branchStatus: record.branchStatus,
          inactive: record.inactive,
        })),
        beforeTurnNumber: 11,
      }),
      true
    );
    const sideEntries = loaded
      .filter((turn) => turn.turnNumber >= 11 && turn.turnNumber <= 15)
      .map((turn) => ({
        turnIndex: turn.turnNumber,
        turn: { user: turn.user, assistant: turn.assistant },
      }));
    assert.equal(
      classifyMemoryBatchScopes(sideEntries, { previousWasNoncanonOrBranch: false }).primaryKind,
      "main_canon"
    );
    assert.equal(
      classifyMemoryBatchScopes(sideEntries, { previousWasNoncanonOrBranch: true }).primaryKind,
      "branch_canon"
    );

    const opener = turns[9]!;
    const openerScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: opener.userId,
      sourceUserText: opener.user,
    });
    assert.equal(openerScope.scopeClass, "meaningful_noncanon");
    assert.equal(openerScope.eligible, false);
    assert.equal(reconcile(CHAT, USER, CHAR, opener, [SIDE_FACT]).inserted, 0);

    const callsBeforeSide = modelCalls;
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(modelCalls, callsBeforeSide);
    const sideRow = rowAt(CHAT, 11);
    assert.equal(sideRow.summaryKind, "branch_canon");
    assert.equal(sideRow.branchStatus, "active");
    const sideTurn = turns[11]!;
    const sideScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: sideTurn.userId,
      sourceUserText: sideTurn.user,
    });
    assert.equal(sideScope.scopeClass, "branch_continue");
    assert.equal(sideScope.previousWasNoncanonOrBranch, true);
    assert.equal(sideScope.eligible, false);
    assert.equal(
      shouldRequestEpisodicInSharedInitial({
        userMessage: sideTurn.user,
        memoryFeatureEnabled: true,
        db: getDb(),
        chatId: CHAT,
        sourceUserMessageId: sideTurn.userId,
      }),
      false
    );
    assert.equal(reconcile(CHAT, USER, CHAR, sideTurn, [SIDE_FACT]).inserted, 0);

    const callsBeforeRegen = modelCalls;
    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "ParityChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 13,
      }),
      true
    );
    assert.equal(modelCalls, callsBeforeRegen);
    assert.equal(rowAt(CHAT, 11).summaryKind, "branch_canon");

    closing = true;
    const callsBeforeClose = modelCalls;
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(modelCalls, callsBeforeClose);
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");
    assert.equal(rowAt(CHAT, 16).branchStatus, "closed");
    assert.doesNotMatch(lorebook(CHAT), /청룡/);
    for (const compacted of compactAfterClose) {
      assert.doesNotMatch(compacted, /청룡/);
    }

    const callsBeforeReturn = modelCalls;
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(modelCalls, callsBeforeReturn + 1);
    const returnRow = rowAt(CHAT, 21);
    assert.equal(returnRow.summaryKind, "main_canon");
    assert.match(lorebook(CHAT), /은방울/);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);

    const returnTurn = turns[21]!;
    const returnScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: returnTurn.userId,
      sourceUserText: returnTurn.user,
    });
    assert.equal(returnScope.scopeClass, "main_rp");
    assert.equal(returnScope.previousWasNoncanonOrBranch, false);
    assert.equal(returnScope.eligible, true);
    assert.equal(reconcile(CHAT, USER, CHAR, returnTurn, [BELL_FACT]).inserted, 1);

    const recalled = getEpisodicMemoryForPrompt(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      currentTurn: 30,
      currentUserMessage: "청동 열쇠와 은방울 서약을 기억해.",
      minAgeTurns: 0,
    });
    assert.match(recalled.promptBlock, /청동 열쇠/);
    assert.match(recalled.promptBlock, /은방울/);
    assert.doesNotMatch(recalled.promptBlock, /청룡/);

    const beforeDelete = lorebook(CHAT);
    const beforeKinds = listMemoryRecordsForChat(CHAT).map((record) => ({
      turnStart: record.turnStart,
      summaryKind: record.summaryKind,
      branchStatus: record.branchStatus,
    }));
    const frontier = turns[25]!;
    getDb().prepare("DELETE FROM messages WHERE id IN (?, ?)").run(frontier.userId, frontier.assistantId);
    assert.deepEqual(
      listMemoryRecordsForChat(CHAT).map((record) => ({
        turnStart: record.turnStart,
        summaryKind: record.summaryKind,
        branchStatus: record.branchStatus,
      })),
      beforeKinds
    );
    assert.equal(lorebook(CHAT), beforeDelete);
    assert.deepEqual(
      listMemoryRecordsForChat(CHAT).map((record) => record.turnStart),
      [1, 6, 11, 16, 21]
    );
  });

  it("adopts an open side batch into main and leaves the next main line eligible", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("adopt path must not call the main summarizer");
    });
    __setCompactCurrentMemoryTestOverride(async (existing) => existing);

    for (let turn = 1; turn <= 5; turn += 1) {
      insertTurn(ADOPT_CHAT, `(OOC: 외전 장면 ${turn})`, `외전 응답 ${turn}`);
    }
    for (let turn = 6; turn <= 10; turn += 1) {
      insertTurn(ADOPT_CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    }
    const adoptBatch: StoredTurn[] = [];
    for (let turn = 11; turn <= 14; turn += 1) {
      const pair = insertTurn(ADOPT_CHAT, ADOPT_BEAT, "백금 부채가 펼쳐진다.");
      adoptBatch.push({
        turn,
        ...pair,
        user: ADOPT_BEAT,
        assistant: "백금 부채가 펼쳐진다.",
      });
    }
    const adopt = insertTurn(ADOPT_CHAT, ADOPT_USER_TEXT, "그 장면을 본편으로 둔다.");
    const nextMain = insertTurn(ADOPT_CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);

    assert.equal(await seal(ADOPT_CHAT, ADOPT_USER, ADOPT_CHAR, "AdoptChar"), true);
    assert.equal(rowAt(ADOPT_CHAT, 1).summaryKind, "noncanon");
    assert.equal(await seal(ADOPT_CHAT, ADOPT_USER, ADOPT_CHAR, "AdoptChar"), true);
    assert.equal(rowAt(ADOPT_CHAT, 6).summaryKind, "branch_canon");
    assert.equal(rowAt(ADOPT_CHAT, 6).branchStatus, "active");
    assert.match(lorebook(ADOPT_CHAT), /청룡/);

    assert.equal(await seal(ADOPT_CHAT, ADOPT_USER, ADOPT_CHAR, "AdoptChar"), true);
    const adopted = rowAt(ADOPT_CHAT, 11);
    assert.equal(adopted.summaryKind, "main_canon");
    assert.equal(adopted.promotedBy, "user_main_adopt");
    assert.equal(adopted.branchStatus, "closed");
    assert.equal(rowAt(ADOPT_CHAT, 6).branchStatus, "closed");
    assert.match(lorebook(ADOPT_CHAT), /백금 부채/);
    assert.doesNotMatch(lorebook(ADOPT_CHAT), /청룡/);

    const adoptScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: ADOPT_CHAT,
      sourceUserMessageId: adopt.userId,
      sourceUserText: ADOPT_USER_TEXT,
    });
    assert.equal(adoptScope.scopeClass, "main_adopt");
    assert.equal(adoptScope.eligible, false);
    const nextScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: ADOPT_CHAT,
      sourceUserMessageId: nextMain.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(nextScope.scopeClass, "main_rp");
    assert.equal(nextScope.eligible, true);
    assert.equal(adoptBatch.length, 4);
  });

  it("keeps a UI-reopened branch open across the older user close", async () => {
    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("ui reopen path must not call the main summarizer");
    });
    __setCompactCurrentMemoryTestOverride(async (existing) => existing);

    for (let turn = 1; turn <= 5; turn += 1) {
      insertTurn(CHAT, `(OOC: 외전 장면 ${turn})`, `외전 응답 ${turn}`);
    }
    for (let turn = 6; turn <= 14; turn += 1) {
      insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    }
    insertTurn(CHAT, CLOSE_USER, "광장의 본편으로 돌아온다.");
    const frontier = insertTurn(CHAT, "자리를 지킨다.", "그 자리에 남는다.");

    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(rowAt(CHAT, 6).summaryKind, "branch_canon");
    assert.equal(rowAt(CHAT, 6).branchStatus, "closed");
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");

    getDb()
      .prepare("DELETE FROM messages WHERE id IN (?, ?)")
      .run(frontier.userId, frontier.assistantId);
    const reopened = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: rowAt(CHAT, 6).id,
      source: "ui_reopen",
    });
    assert.equal(reopened.ok, true);
    assert.equal(rowAt(CHAT, 6).branchStatus, "active");
    assert.equal(rowAt(CHAT, 11).branchStatus, "active");

    const scene = insertTurn(CHAT, RESUME_BEAT, RESUME_ASSISTANT);
    for (let extra = 0; extra < 4; extra += 1) {
      insertTurn(CHAT, RESUME_BEAT, RESUME_ASSISTANT);
    }
    insertTurn(CHAT, "자리를 지킨다.", "그 자리에 남는다.");

    const loaded = loadMemoryEligibleChatTurnsWithMessageIds(CHAT);
    const sceneTurn = loaded.find((turn) => turn.userMessageId === scene.userId);
    assert.ok(sceneTurn);
    const snapshots = listMemoryRecordsForChat(CHAT).map((record) => ({
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      summaryKind: record.summaryKind,
      branchStatus: record.branchStatus,
      inactive: record.inactive,
    }));
    assert.equal(
      resolveSharedPreviousBranchState({
        priorUserMessages: loaded
          .filter((turn) => turn.turnNumber < sceneTurn.turnNumber)
          .map((turn) => turn.user),
        priorTurns: loaded
          .filter((turn) => turn.turnNumber < sceneTurn.turnNumber)
          .map((turn) => ({ turnNumber: turn.turnNumber, user: turn.user })),
        sealedRecords: snapshots,
        beforeTurnNumber: sceneTurn.turnNumber,
      }),
      true
    );

    const sceneScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: scene.userId,
      sourceUserText: RESUME_BEAT,
    });
    assert.equal(sceneScope.previousWasNoncanonOrBranch, true);
    assert.equal(sceneScope.scopeClass, "branch_continue");
    assert.equal(sceneScope.eligible, false);
    assert.equal(reconcile(CHAT, USER, CHAR, {
      turn: sceneTurn.turnNumber,
      userId: scene.userId,
      assistantId: scene.assistantId,
      user: RESUME_BEAT,
      assistant: RESUME_ASSISTANT,
    }, [SIDE_FACT]).inserted, 0);

    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    const resumed = rowAt(CHAT, sceneTurn.turnNumber);
    assert.equal(resumed.summaryKind, "branch_canon");
    assert.equal(resumed.branchStatus, "active");
    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "ParityChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: sceneTurn.turnNumber,
      }),
      true
    );
    assert.equal(rowAt(CHAT, sceneTurn.turnNumber).summaryKind, "branch_canon");

    const newerClose = insertTurn(CHAT, CLOSE_USER, "다시 본편으로 돌아온다.");
    const afterClose = insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    const afterLoaded = loadMemoryEligibleChatTurnsWithMessageIds(CHAT);
    const afterTurn = afterLoaded.find((turn) => turn.userMessageId === afterClose.userId);
    assert.ok(afterTurn);
    const afterSnapshots = listMemoryRecordsForChat(CHAT).map((record) => ({
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      summaryKind: record.summaryKind,
      branchStatus: record.branchStatus,
      inactive: record.inactive,
    }));
    assert.equal(
      resolveSharedPreviousBranchState({
        priorTurns: afterLoaded
          .filter((turn) => turn.turnNumber < afterTurn.turnNumber)
          .map((turn) => ({ turnNumber: turn.turnNumber, user: turn.user })),
        sealedRecords: afterSnapshots,
        beforeTurnNumber: afterTurn.turnNumber,
      }),
      false
    );
    const closeScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: newerClose.userId,
      sourceUserText: CLOSE_USER,
    });
    assert.equal(closeScope.scopeClass, "branch_close");
    assert.equal(closeScope.eligible, false);
    const afterScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: afterClose.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(afterScope.previousWasNoncanonOrBranch, false);
    assert.equal(afterScope.scopeClass, "main_rp");
    assert.equal(afterScope.eligible, true);
  });

  it("UI close resumes main episodic and the next summary without a user close sentence", async () => {
    const tail = "[OOC: 외전을 이어 간다. 청룡 골목의 등을 켠다.]";
    const preference = "(OOC: 앞으로 말투는 짧게 유지해)";
    __setCompactCurrentMemoryTestOverride(async (existing) => existing);
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      const content = history[0]?.content ?? "";
      if (content.includes("청룡") || content.includes("은화")) {
        throw new Error("side-story batch must not call the main summarizer");
      }
      const lines = [...content.matchAll(/ParityChar: ([^\n]+)/g)].map((match) => match[1]!.trim());
      let text = lines.join(" ");
      while (text.length < 80) {
        text = `${text} ${lines[0] ?? MAIN_ASSISTANT}`.trim();
      }
      return { text };
    });

    let earlyMain: { userId: number; assistantId: number } | null = null;
    for (let turn = 1; turn <= 9; turn += 1) {
      const inserted = insertTurn(CHAT, MAIN_USER, MAIN_ASSISTANT);
      if (turn === 2) earlyMain = inserted;
    }
    assert.ok(earlyMain);
    insertTurn(CHAT, OPENER, "청룡 가면 상인이 야시장에 서 있다.");
    for (let turn = 11; turn <= 15; turn += 1) insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    const unsealed = insertTurn(CHAT, tail, "청룡 골목에 등이 켜진다.");
    insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    const frontierAtClose = insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);

    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(rowAt(CHAT, 6).summaryKind, "main_canon");
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(rowAt(CHAT, 11).summaryKind, "branch_canon");
    assert.equal(rowAt(CHAT, 11).branchStatus, "active");

    const openTail = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: frontierAtClose.userId,
      sourceUserText: SIDE_BEAT,
    });
    assert.equal(openTail.scopeClass, "branch_continue");
    assert.equal(openTail.eligible, false);

    assert.equal(closeActiveBranchCanon(CHAT, { source: "ui" }), 1);
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");
    const closedPayload = parseScopePayload(
      (
        getDb()
          .prepare("SELECT scope_payload FROM chat_turn_summaries WHERE id=?")
          .get(rowAt(CHAT, 11).id) as { scope_payload: string }
      ).scope_payload
    );
    const uiClose = closedPayload?.branchControlMutations?.at(-1);
    assert.equal(uiClose?.action, "close_branch");
    assert.equal(uiClose?.source, "ui");
    assert.equal(uiClose?.sourceTurn, 18);
    assert.equal(uiClose?.sourceUserMessageId, frontierAtClose.userId);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);

    const preferenceTurn = insertTurn(CHAT, preference, "말투를 짧게 유지한다.");
    const preferenceScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: preferenceTurn.userId,
      sourceUserText: preference,
    });
    assert.equal(preferenceScope.previousWasNoncanonOrBranch, false);
    assert.equal(preferenceScope.scopeClass, "preference");
    assert.equal(preferenceScope.eligible, true);

    const returned = insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    const returnedScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: returned.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(returnedScope.previousWasNoncanonOrBranch, false);
    assert.equal(returnedScope.scopeClass, "main_rp");
    assert.equal(returnedScope.eligible, true);
    assert.equal(
      reconcile(CHAT, USER, CHAR, {
        turn: returned.turn,
        userId: returned.userId,
        assistantId: returned.assistantId,
        user: NEW_MAIN_USER,
        assistant: NEW_MAIN_ASSISTANT,
      }, [BELL_FACT]).inserted,
      1
    );

    insertTurn(CHAT, "자리를 지킨다.", "그 자리에 남는다.");
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    const straddling = rowAt(CHAT, 16);
    assert.equal(straddling.summaryKind, "main_canon");
    assert.doesNotMatch(lorebook(CHAT), /청룡/);
    assert.match(lorebook(CHAT), /은방울/);

    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "ParityChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 11,
      }),
      true
    );
    assert.equal(rowAt(CHAT, 11).summaryKind, "branch_canon");
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");
    assert.equal(rowAt(CHAT, 11).branchControlMutations?.at(-1)?.source, "ui");
    assert.equal(
      rowAt(CHAT, 11).branchControlMutations?.at(-1)?.sourceUserMessageId,
      frontierAtClose.userId
    );
    assert.doesNotMatch(lorebook(CHAT), /청룡/);

    getDb()
      .prepare("DELETE FROM messages WHERE id IN (?, ?)")
      .run(earlyMain.userId, earlyMain.assistantId);
    const afterDelete = insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    const afterDeleteScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: afterDelete.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(afterDeleteScope.scopeClass, "main_rp");
    assert.equal(afterDeleteScope.eligible, true);
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");

    const reopened = reopenClosedBranchCanon({
      chatId: CHAT,
      recordId: rowAt(CHAT, 11).id,
      source: "ui_reopen",
    });
    assert.equal(reopened.ok, true);
    const resumed = insertTurn(CHAT, RESUME_BEAT, RESUME_ASSISTANT);
    const resumedScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: resumed.userId,
      sourceUserText: RESUME_BEAT,
    });
    assert.equal(resumedScope.previousWasNoncanonOrBranch, true);
    assert.equal(resumedScope.scopeClass, "branch_continue");
    assert.equal(resumedScope.eligible, false);
    assert.match(lorebook(CHAT), /청룡/);

    assert.ok(closeActiveBranchCanon(CHAT, { source: "ui" }) >= 1);
    const afterReclose = insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    const afterRecloseScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: afterReclose.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(afterRecloseScope.scopeClass, "main_rp");
    assert.equal(afterRecloseScope.eligible, true);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);

    insertTurn(CHAT, OPENER, "새 외전의 청룡 가판이 다시 선다.");
    const nextSide = insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    const nextSideScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: nextSide.userId,
      sourceUserText: SIDE_BEAT,
    });
    assert.equal(nextSideScope.previousWasNoncanonOrBranch, true);
    assert.equal(nextSideScope.scopeClass, "branch_continue");
    assert.equal(nextSideScope.eligible, false);
    assert.notEqual(uiClose?.sourceUserMessageId, unsealed.userId);
  });

  it("deleting the UI close frontier turn keeps the next main line on main", async () => {
    __setCompactCurrentMemoryTestOverride(async (existing) => existing);
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      const content = history[0]?.content ?? "";
      if (content.includes("청룡") || content.includes("은화")) {
        throw new Error("side-story batch must not call the main summarizer");
      }
      const lines = [...content.matchAll(/ParityChar: ([^\n]+)/g)].map((match) => match[1]!.trim());
      let text = lines.join(" ");
      while (text.length < 80) {
        text = `${text} ${lines[0] ?? MAIN_ASSISTANT}`.trim();
      }
      return { text };
    });

    for (let turn = 1; turn <= 9; turn += 1) insertTurn(CHAT, MAIN_USER, MAIN_ASSISTANT);
    insertTurn(CHAT, OPENER, "청룡 가면 상인이 야시장에 서 있다.");
    for (let turn = 11; turn <= 17; turn += 1) insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    const frontier = insertTurn(CHAT, SIDE_BEAT, SIDE_ASSISTANT);
    assert.equal(frontier.turn, 18);

    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    assert.equal(rowAt(CHAT, 11).branchStatus, "active");

    assert.equal(closeActiveBranchCanon(CHAT, { source: "ui" }), 1);
    const closed = parseScopePayload(
      (
        getDb()
          .prepare("SELECT scope_payload FROM chat_turn_summaries WHERE id=?")
          .get(rowAt(CHAT, 11).id) as { scope_payload: string }
      ).scope_payload
    )?.branchControlMutations?.at(-1);
    assert.equal(closed?.source, "ui");
    assert.equal(closed?.sourceTurn, 18);
    assert.equal(closed?.sourceUserMessageId, frontier.userId);

    executeLastTurnDeleteTransaction(getDb(), {
      chatId: CHAT,
      characterId: CHAR,
      userMessageId: frontier.userId,
      assistantMessageId: frontier.assistantId,
      revertNumeric: false,
    });
    assert.equal(
      reconcileMemoryAfterTurnDelete({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "ParityChar",
        tier: "free",
        memoryCapacity: 8000,
        deletedUserMessageId: frontier.userId,
        deletedAssistantMessageId: frontier.assistantId,
        deletedPlayableTurn: 18,
      }),
      true
    );
    assert.equal(rowAt(CHAT, 11).branchStatus, "closed");
    assert.equal(
      rowAt(CHAT, 11).branchControlMutations?.at(-1)?.sourceUserMessageId,
      frontier.userId
    );

    const returned = insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    assert.equal(returned.turn, 18);
    const returnedScope = resolveEpisodicEligibilityForSourceUserMessage(getDb(), {
      chatId: CHAT,
      sourceUserMessageId: returned.userId,
      sourceUserText: NEW_MAIN_USER,
    });
    assert.equal(returnedScope.previousWasNoncanonOrBranch, false);
    assert.equal(returnedScope.scopeClass, "main_rp");
    assert.equal(returnedScope.eligible, true);

    insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    insertTurn(CHAT, NEW_MAIN_USER, NEW_MAIN_ASSISTANT);
    insertTurn(CHAT, "자리를 지킨다.", "그 자리에 남는다.");
    assert.equal(await seal(CHAT, USER, CHAR, "ParityChar"), true);
    const sealed = rowAt(CHAT, 16);
    assert.equal(sealed.summaryKind, "main_canon");
    assert.equal(sealed.branchStatus, null);
    assert.doesNotMatch(lorebook(CHAT), /청룡/);
    assert.match(lorebook(CHAT), /은방울/);
  });

  it("legacy UI close stored only as sourceTurn still closes before later main text", () => {
    const previous = resolveSharedPreviousBranchState({
      priorTurns: [
        { turnNumber: 1, user: OPENER, userMessageId: 11 },
        { turnNumber: 2, user: SIDE_BEAT, userMessageId: 12 },
        { turnNumber: 3, user: SIDE_BEAT, userMessageId: 13 },
        { turnNumber: 4, user: NEW_MAIN_USER, userMessageId: 14 },
      ],
      sealedRecords: [
        {
          turnStart: 1,
          turnEnd: 5,
          summaryKind: "branch_canon",
          branchStatus: "closed",
          inactive: false,
          branchControlMutations: [
            {
              action: "close_branch",
              source: "ui",
              sourceUserMessageId: null,
              sourceTurn: 3,
              at: "2026-01-01T00:00:00.000Z",
              previous: {
                summaryKind: "branch_canon",
                scopes: {},
                branchId: "legacy-branch",
                branchStatus: "active",
                promotedBy: null,
                promotedAt: null,
              },
            },
          ],
        },
      ],
      beforeTurnNumber: 5,
    });
    assert.equal(previous, false);
  });
});

function resolvePreviousOpen(messages: string[]): boolean {
  return resolveSharedPreviousBranchState({
    priorUserMessages: messages,
    sealedRecords: [],
  });
}
