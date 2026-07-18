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
import { afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { encodeScopePayload } from "./memory-summary-scope";
import { getOrCreateChatMemory } from "./memory-db";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  listVisibleMemoryRecordsForChat,
  rebuildLorebookFromRecords,
} from "./memory-turn-summary";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  refreshRollingSummaryForRegeneratedAssistant,
  regenerateMemoryRecordBatch,
  resolveBatchStartTurnForTurnNumber,
} from "./memory-rolling-summary";
import { MEMORY_SCOPE_NEVER_TOUCHES_GLOBAL_CANON } from "./memory-summary-scope";

const CHAT = 910811;
const USER = 910812;
const CHAR = 910813;

const MAIN_NARRATIVE_A =
  "본편에서 사건_A가 발생했다 → 인물이 반응하고 다음 행동을 결정했다 → " +
  "관계 흐름이 바뀌며 둘만의 약속을 남겼다 → 이별 전 장면을 정리하며 감정을 확인했다.";
const MAIN_NARRATIVE_B =
  "본편에서 사건_B가 발생했다 → 인물이 다른 선택을 했고 결과가 갈렸다 → " +
  "관계 방향이 바뀌며 새로운 목표가 생겼다 → 장면을 갱신하며 다음 만남을 남겼다.";

const PREF_TEXT = "유저 고정 요청: (OOC: 앞으로 항상 3인칭으로 써줘)";

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
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `regen-scope-${USER}@test.local`,
    "regen-scope",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "RegenChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary) VALUES (?,?,?,'safe','')`
  ).run(CHAT, USER, CHAR);
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function insertGreeting() {
  getDb()
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    )
    .run(CHAT, "assistant", "인사.", "greeting");
}

/** Returns assistant message ids for playable turns 1..n in order. */
function insertPlayableTurns(
  turns: Array<{ user: string; assistant: string }>
): number[] {
  const db = getDb();
  const assistantIds: number[] = [];
  for (const t of turns) {
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    ).run(CHAT, "user", t.user, "");
    const r = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
      )
      .run(CHAT, "assistant", t.assistant, "test");
    assistantIds.push(Number(r.lastInsertRowid));
  }
  return assistantIds;
}

function updateAssistant(id: number, content: string) {
  getDb().prepare(`UPDATE messages SET content=? WHERE id=?`).run(content, id);
}

function chatCurrentSummary(): string {
  const row = getDb()
    .prepare(`SELECT current_summary FROM chats WHERE id=?`)
    .get(CHAT) as { current_summary: string | null };
  return row.current_summary ?? "";
}

function memSummarized(): number {
  const row = getDb()
    .prepare(`SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?`)
    .get(CHAT) as { summarized_turn_count: number } | undefined;
  return row?.summarized_turn_count ?? -1;
}

describe("assistant regeneration rebuilds full scopePayload", () => {
  let modelCalls = 0;

  beforeEach(() => {
    seedChat();
    modelCalls = 0;
    __setCompactCurrentMemoryTestOverride(async (text) => text);
    __setSummarizeTurnBatchCallerForTests(async () => {
      modelCalls += 1;
      return { text: MAIN_NARRATIVE_B };
    });
  });

  afterEach(() => {
    __setSummarizeTurnBatchCallerForTests(null);
    __setCompactCurrentMemoryTestOverride(null);
    cleanup();
  });

  it("A. noncanon assistant regeneration replaces old scene only", async () => {
    insertGreeting();
    const ids = insertPlayableTurns([
      {
        user: "(OOC: 가상 배경 IF 장면을 보여줘)",
        assistant: "배경_A에서 사건_A가 발생함.",
      },
      { user: "(OOC: IF 이어서)", assistant: "중간 장면 진행." },
      { user: "(OOC: IF 이어서)", assistant: "추가 진행." },
      { user: "(OOC: IF 이어서)", assistant: "추가 진행2." },
      { user: "(OOC: IF 이어서)", assistant: "추가 진행3." },
      { user: "(OOC: IF 이어서)", assistant: "추가 진행4." },
    ]);

    const oldNon = "비정사·번외: 배경_A에서 사건_A가 발생함.";
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: oldNon,
      summaryKind: "noncanon",
      scopePayload: {
        v: 1,
        scopes: { noncanon: oldNon },
      },
      playableTurnCount: 6,
    });

    updateAssistant(ids[0]!, "배경_B에서 사건_B가 발생함.");
    const beforeCount = memSummarized();
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[0]!,
    });
    assert.equal(ok, true);
    assert.equal(modelCalls, 0, "noncanon-only must not call summary model");
    assert.equal(memSummarized(), beforeCount);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(row.summaryKind, "noncanon");
    assert.match(row.scopes.noncanon ?? "", /사건_B|배경_B/);
    assert.doesNotMatch(row.scopes.noncanon ?? "", /사건_A|배경_A/);
    assert.doesNotMatch(row.summary, /사건_A|배경_A/);
    assert.doesNotMatch(chatCurrentSummary(), /사건_A|배경_A/);
    assert.equal(listMemoryRecordsForChat(CHAT).length, 1);
  });

  it("B. main_canon regeneration replaces old narrative", async () => {
    insertGreeting();
    const ids = insertPlayableTurns(
      Array.from({ length: 6 }, (_, i) => ({
        user: `본편 행동 ${i + 1}`,
        assistant: i === 2 ? "본편에서 사건_A 발생" : `본편 응답 ${i + 1}`,
      }))
    );

    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: MAIN_NARRATIVE_A,
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: MAIN_NARRATIVE_A } },
      playableTurnCount: 6,
    });

    updateAssistant(ids[2]!, "본편에서 사건_B 발생");
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[2]!,
    });
    assert.equal(ok, true);
    assert.equal(modelCalls, 1);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(row.summaryKind, "main_canon");
    assert.match(row.scopes.main_canon ?? "", /사건_B/);
    assert.doesNotMatch(row.scopes.main_canon ?? "", /사건_A/);
    assert.doesNotMatch(rebuildLorebookFromRecords(CHAT), /사건_A/);
    assert.doesNotMatch(chatCurrentSummary(), /사건_A/);
  });

  it("C. mixed batch rebuild preserves main/preference and replaces noncanon", async () => {
    insertGreeting();
    const ids = insertPlayableTurns([
      { user: "정원에서 만난다.", assistant: "본편 인사." },
      { user: "선물을 건넨다.", assistant: "본편 수락." },
      {
        user: "(OOC: 가상 현대 회사 IF 장면을 보여줘)",
        assistant: "배경_A에서 사건_A가 발생함.",
      },
      {
        user: "(OOC: 앞으로 항상 3인칭으로 써줘)",
        assistant: "알겠어.",
      },
      { user: "본편으로 돌아와 산책한다.", assistant: "본편 산책." },
      { user: "약속을 남긴다.", assistant: "본편 약속." },
    ]);

    const oldNon = "비정사·번외: 배경_A → 사건_A";
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: MAIN_NARRATIVE_A,
      summaryKind: "main_canon",
      scopePayload: {
        v: 1,
        scopes: {
          main_canon: MAIN_NARRATIVE_A,
          noncanon: oldNon,
          preference: PREF_TEXT,
        },
      },
      playableTurnCount: 6,
    });

    updateAssistant(ids[2]!, "배경_B에서 사건_B가 발생함.");
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[2]!,
    });
    assert.equal(ok, true);
    assert.equal(modelCalls, 1);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(row.summaryKind, "main_canon");
    assert.match(row.scopes.main_canon ?? "", /사건_B/);
    assert.doesNotMatch(row.scopes.main_canon ?? "", /사건_A/);
    assert.match(row.scopes.noncanon ?? "", /사건_B|배경_B/);
    assert.doesNotMatch(row.scopes.noncanon ?? "", /사건_A|배경_A/);
    assert.match(row.scopes.preference ?? "", /3인칭/);
    // No scope bleed into lorebook from noncanon
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.match(lore, /사건_B/);
    assert.doesNotMatch(lore, /사건_A/);
    assert.doesNotMatch(lore, /배경_A/);
  });

  it("D. empty model output does not overwrite prior valid summary", async () => {
    insertGreeting();
    const ids = insertPlayableTurns(
      Array.from({ length: 6 }, (_, i) => ({
        user: `본편 행동 ${i + 1}`,
        assistant: `본편 응답 ${i + 1}`,
      }))
    );

    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: MAIN_NARRATIVE_A,
      summaryKind: "main_canon",
      scopePayload: { v: 1, scopes: { main_canon: MAIN_NARRATIVE_A } },
      playableTurnCount: 6,
    });

    __setSummarizeTurnBatchCallerForTests(async () => {
      modelCalls += 1;
      return { text: "" };
    });

    updateAssistant(ids[1]!, "본편에서 사건_B 발생");
    const before = listMemoryRecordsForChat(CHAT)[0]!;
    const beforePayload = encodeScopePayload({
      v: 1,
      scopes: before.scopes,
      branchId: before.branchId,
      branchStatus: before.branchStatus,
    });
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[1]!,
    });
    assert.equal(ok, false);
    // One compose path invokes summarizeTurnBatch once; that helper may retry internally.
    assert.ok(modelCalls >= 1 && modelCalls <= 3);

    const after = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(after.summary, MAIN_NARRATIVE_A);
    assert.equal(after.scopes.main_canon, MAIN_NARRATIVE_A);
    assert.equal(memSummarized(), 6);
    assert.equal(listMemoryRecordsForChat(CHAT).length, 1);
    const afterPayload = encodeScopePayload({
      v: 1,
      scopes: after.scopes,
      branchId: after.branchId,
      branchStatus: after.branchStatus,
    });
    assert.equal(afterPayload, beforePayload);
  });

  it("branch_id and closed status survive regeneration; adopt stays locked", async () => {
    insertGreeting();
    const ids = insertPlayableTurns([
      {
        user: "(OOC: 가상 세계 IF 장면을 보여줘)",
        assistant: "배경_A에서 사건_A.",
      },
      { user: "(OOC: IF 이어서 계속)", assistant: "분기 이어짐 A." },
      { user: "(OOC: IF 이어서 다음 장면)", assistant: "분기 이어짐 B." },
      { user: "(OOC: IF 이어서)", assistant: "분기 이어짐 C." },
      { user: "(OOC: IF 이어서)", assistant: "분기 이어짐 D." },
      { user: "(OOC: IF 이어서)", assistant: "분기 이어짐 E." },
    ]);

    const branchId = `branch-${CHAT}-1`;
    const branchText = "비정사·번외: 배경_A → 사건_A → 분기 이어짐";
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: branchText,
      summaryKind: "branch_canon",
      branchId,
      branchStatus: "active",
      promotedBy: "user_continue",
      promotedAt: "2026-01-01T00:00:00.000Z",
      scopePayload: {
        v: 1,
        scopes: { branch_canon: branchText },
        branchId,
        branchStatus: "active",
        promotedBy: "user_continue",
        promotedAt: "2026-01-01T00:00:00.000Z",
      },
      playableTurnCount: 6,
    });

    updateAssistant(ids[0]!, "배경_B에서 사건_B.");
    const ok = await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      turnStart: 3,
    });
    assert.equal(ok, true);
    assert.equal(modelCalls, 0);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(row.summaryKind, "branch_canon");
    assert.equal(row.branchId, branchId);
    assert.equal(row.branchStatus, "active");
    assert.match(row.scopes.branch_canon ?? "", /사건_B|배경_B/);
    assert.doesNotMatch(row.scopes.branch_canon ?? "", /사건_A|배경_A/);

    // Closed branch status must not be reset by assistant-only regen.
    getDb()
      .prepare(
        `UPDATE chat_turn_summaries SET branch_status='closed', summary_kind='branch_canon' WHERE chat_id=? AND turn_number=1`
      )
      .run(CHAT);
    updateAssistant(ids[1]!, "분기 이어짐 B-new.");
    const ok2 = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[1]!,
    });
    assert.equal(ok2, true);
    const closed = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(closed.branchStatus, "closed");
    assert.equal(closed.branchId, branchId);
  });

  it("same regeneration is idempotent — one active row, no duplicate LTM", async () => {
    insertGreeting();
    const ids = insertPlayableTurns([
      {
        user: "(OOC: 가상 배경 IF 장면을 보여줘)",
        assistant: "배경_B에서 사건_B가 발생함.",
      },
      { user: "(OOC: IF 이어서)", assistant: "중간1." },
      { user: "(OOC: IF 이어서)", assistant: "중간2." },
      { user: "(OOC: IF 이어서)", assistant: "중간3." },
      { user: "(OOC: IF 이어서)", assistant: "중간4." },
      { user: "(OOC: IF 이어서)", assistant: "중간5." },
    ]);

    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: "비정사·번외: 배경_A에서 사건_A가 발생함.",
      summaryKind: "noncanon",
      scopePayload: {
        v: 1,
        scopes: { noncanon: "비정사·번외: 배경_A에서 사건_A가 발생함." },
      },
      playableTurnCount: 6,
    });

    const once = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[0]!,
    });
    const twice = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: ids[0]!,
    });
    assert.equal(once, true);
    assert.equal(twice, true);
    assert.equal(modelCalls, 0);
    assert.equal(listMemoryRecordsForChat(CHAT).length, 1);
    assert.equal(listVisibleMemoryRecordsForChat(CHAT).length, 1);
    assert.equal(resolveBatchStartTurnForTurnNumber(4), 1);

    const lore = rebuildLorebookFromRecords(CHAT);
    // noncanon excluded from lorebook
    assert.equal(lore.includes("사건_B"), false);
    assert.equal(MEMORY_SCOPE_NEVER_TOUCHES_GLOBAL_CANON, true);
  });

  it("empty_ooc is recalculated when batch is plain OOC only", async () => {
    insertGreeting();
    const ids = insertPlayableTurns(
      Array.from({ length: 6 }, () => ({
        user: "(OOC: 문체를 더 짧게 써줘)",
        assistant: "알겠어.",
      }))
    );

    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: ids[5]!,
      summary: "비정사·번외: 예전 IF",
      summaryKind: "noncanon",
      scopePayload: { v: 1, scopes: { noncanon: "비정사·번외: 예전 IF" } },
      playableTurnCount: 6,
    });

    const ok = await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "RegenChar",
      tier: "free",
      memoryCapacity: 8000,
      turnStart: 1,
    });
    assert.equal(ok, true);
    assert.equal(modelCalls, 0);
    const row = listMemoryRecordsForChat(CHAT)[0]!;
    assert.equal(row.summaryKind, "empty_ooc");
    assert.ok(row.scopes.empty_ooc || row.summary);
    assert.equal(rebuildLorebookFromRecords(CHAT).trim(), "");
  });
});
