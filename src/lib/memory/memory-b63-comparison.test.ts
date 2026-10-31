import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory } from "./memory-db";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  B63_PAST_SEARCH_MAX_CHARS,
  B63_RECENT_DETAIL_MAX_CHARS,
  B63_RECENT_DETAIL_MAX_TOKENS,
  buildRecentTurnDetailProjection,
  searchPastTurnSummaries,
} from "./memory-b63-comparison";
import { listPromptInjectibleMemoryRecords } from "./memory-turn-summary";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { buildMemoryContextForPreview } from "./memory-manager";
import { buildContext } from "@/services/contextBuilder";

const USER = 99001;
const CHAR = 99002;
const CHAT_A = 99010;
const CHAT_B = 99011;
const CHAT_C = 99012;
const CHAT_D = 99013;
const CHAT_E = 99014;
const CHAT_F = 99015;
const CHAT_G = 99016;
const CHAT_H = 99017;
const CHAT_I = 99018;
const CHAT_J = 99019;
const CHAT_K = 99020;
const CHAT_L = 99021;
const CHAT_M = 99022;
const CHAT_N = 99023;
const TURNS = 36;

const TOPICS: Record<number, string> = {
  11: "harbor patrol",
  12: "weapon check",
  13: "night watch",
  14: "med bay",
  15: "silver key inventory",
  16: "training drill",
  17: "radio static",
  18: "supply crate",
  19: "rain shelter",
  20: "ring inspection",
  21: "promise review",
  22: "armory lock",
  23: "route planning",
  24: "cold storage",
  25: "signal relay",
  26: "dawn briefing",
  27: "vehicle repair",
  28: "cipher update",
  29: "medical follow-up",
  30: "night report",
};

function insertChat(chatId: number) {
  getDb()
    .prepare("INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')")
    .run(chatId, USER, CHAR);
  getOrCreateChatMemory(chatId, USER, CHAR, "free");
}

function insertMessages(chatId: number) {
  const insert = getDb().prepare(
    "INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status) VALUES (?,?,?,?,?,'completed')"
  );
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const uid = Number(
      insert
        .run(chatId, "user", `User turn ${turn} asks about ${TOPICS[turn] ?? "the mission"}.`, "test-model", null)
        .lastInsertRowid
    );
    insert.run(
      chatId,
      "assistant",
      `Assistant turn ${turn} answers about ${TOPICS[turn] ?? "the mission"}.`,
      "test-model",
      uid
    );
  }
}

function insertTurn(chatId: number, turn: number, user: string, assistant: string) {
  const insert = getDb().prepare(
    "INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status) VALUES (?,?,?,?,?,'completed')"
  );
  const uid = Number(insert.run(chatId, "user", user, "test-model", null).lastInsertRowid);
  insert.run(chatId, "assistant", assistant, "test-model", uid);
}

function summary(chatId: number, start: number, end: number, text: string, extra: Partial<Parameters<typeof upsertSummaryRowCore>[0]> = {}) {
  upsertSummaryRowCore({
    chatId,
    turnStart: start,
    turnEnd: end,
    assistantMessageId: null,
    summary: text,
    summaryKind: "narrative",
    userEdited: false,
    ...extra,
  });
}

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
    USER,
    "b63-comparison@test.local",
    "b63",
    "x"
  );
  db.prepare("INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)").run(CHAR, "오스카");
  for (const chatId of [CHAT_A, CHAT_B, CHAT_C, CHAT_D, CHAT_E, CHAT_F, CHAT_G, CHAT_H, CHAT_I, CHAT_J, CHAT_K, CHAT_L, CHAT_M, CHAT_N]) {
    insertChat(chatId);
  }
  insertMessages(CHAT_A);
  insertMessages(CHAT_C);

  // Old summaries: two candidates both contain the recurring name "Oscar".
  summary(CHAT_A, 1, 5, "Oscar made an old promise about the silver key at the harbor.");
  summary(CHAT_A, 6, 10, "Oscar ran a training schedule for the squad and checked the radio.");
  for (let turn = 11; turn <= 30; turn += 1) {
    summary(CHAT_A, turn, turn, `Turn ${turn}: ${TOPICS[turn] ?? "mission event"} for Oscar and the squad.`);
  }
  summary(CHAT_A, 37, 41, "Inactive secret about the red door.", { inactive: true });
  summary(CHAT_A, 42, 46, "Closed branch secret about the blue door.", {
    summaryKind: "branch_canon",
    branchStatus: "closed",
  });
  summary(CHAT_B, 1, 5, "Other chat secret about the green door for Oscar.");

  // Gap fixture: every detail turn except T15.
  for (let turn = 11; turn <= 30; turn += 1) {
    if (turn === 15) continue;
    summary(CHAT_C, turn, turn, `Turn ${turn}: ${TOPICS[turn] ?? "mission event"} for Oscar.`);
  }

  // R1c budget fixtures: 20 per-turn rows at 450 and 500 chars.
  for (let turn = 75; turn <= 94; turn += 1) {
    summary(CHAT_D, turn, turn, "가".repeat(450));
    summary(CHAT_E, turn, turn, "가".repeat(500));
    summary(CHAT_F, turn, turn, "가".repeat(500));
  }
  // Gap + budget: T85 is absent; all other detail turns have 500-char rows.
  for (let turn = 75; turn <= 94; turn += 1) {
    if (turn === 85) continue;
    summary(CHAT_G, turn, turn, "가".repeat(500));
  }
  // Boundary fixture: a 5-turn row crossing detailStart=75 plus per-turn rows.
  summary(CHAT_H, 71, 75, "경계".repeat(100));
  for (let turn = 76; turn <= 94; turn += 1) {
    summary(CHAT_H, turn, turn, "경계".repeat(100));
  }
  // Header-only budget fixture.
  summary(CHAT_L, 75, 75, "가".repeat(100));

  // Search fixtures: the summary matches, while the original quote is mid-range
  // or at the end of a long message and has no query token in it.
  for (let turn = 1; turn <= 15; turn += 1) {
    insertTurn(CHAT_I, turn, `filler ${turn}`, `filler ${turn}`);
  }
  for (let turn = 16; turn <= 20; turn += 1) {
    insertTurn(
      CHAT_I,
      turn,
      `T${turn} routine question`,
      turn === 18 ? "ordinary scene MIDDLE_QUOTE_T18" : `T${turn} ordinary scene`
    );
  }
  summary(CHAT_I, 16, 20, "은빛 열쇠에 관한 약속이 있었다.");
  for (let turn = 1; turn <= 19; turn += 1) {
    insertTurn(CHAT_J, turn, `filler ${turn}`, `filler ${turn}`);
  }
  insertTurn(CHAT_J, 20, "T20 routine question", `${"서술 ".repeat(500)}LATE_QUOTE_T20`);
  summary(CHAT_J, 20, 20, "은빛 열쇠에 관한 약속이 있었다.");
  summary(CHAT_K, 75, 85, "은빛 열쇠 약속 항구");
  summary(CHAT_K, 86, 90, "은빛 열쇠 약속 등대");

  // Query-matched middle turn: only T18 contains the query tokens.
  for (let turn = 1; turn <= 15; turn += 1) {
    insertTurn(CHAT_M, turn, `filler ${turn}`, `filler ${turn}`);
  }
  for (let turn = 16; turn <= 20; turn += 1) {
    insertTurn(
      CHAT_M,
      turn,
      `T${turn} routine question`,
      turn === 18 ? "ordinary scene 은빛 열쇠 약속" : `T${turn} ordinary scene`
    );
  }
  summary(CHAT_M, 16, 20, "은빛 열쇠에 관한 약속이 있었다.");

  // Query-matched late span in a long assistant message.
  for (let turn = 1; turn <= 19; turn += 1) {
    insertTurn(CHAT_N, turn, `filler ${turn}`, `filler ${turn}`);
  }
  insertTurn(CHAT_N, 20, "T20 routine question", `${"서술 ".repeat(500)}은빛 열쇠 약속`);
  summary(CHAT_N, 20, 20, "은빛 열쇠에 관한 약속이 있었다.");
});

after(() => {
  uninstallIsolatedTestDatabase();
});

let prevMemoryFeature: string | undefined;
beforeEach(() => {
  prevMemoryFeature = process.env.MEMORY_FEATURE_ENABLED;
  process.env.MEMORY_FEATURE_ENABLED = "1";
});
afterEach(() => {
  if (prevMemoryFeature === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
  else process.env.MEMORY_FEATURE_ENABLED = prevMemoryFeature;
});

function rawHistory(): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (let turn = 31; turn <= 36; turn += 1) {
    out.push({ role: "user", content: `User turn ${turn} asks about the mission.` });
    out.push({ role: "assistant", content: `Assistant turn ${turn} answers about the mission.` });
  }
  return out;
}

describe("B63 comparison-only memory path", () => {
  it("builds a bounded recent-detail projection from existing per-turn rows", () => {
    const detail = buildRecentTurnDetailProjection({
      chatId: CHAT_A,
      rawStartTurn: 31,
      detailTurnCount: 20,
    });
    assert.equal(detail.detailStart, 11);
    assert.equal(detail.detailEnd, 30);
    assert.equal(detail.blocks.length, 20);
    assert.deepEqual(detail.missingTurns, []);
    assert.match(detail.text, /^\[최근 20턴 상세 기억 — T11~30\]/);
    assert.match(detail.text, /\[T15\]/);
    assert.ok(detail.chars <= B63_RECENT_DETAIL_MAX_CHARS);
  });

  it("reports missing detail turns instead of filling them", () => {
    const detail = buildRecentTurnDetailProjection({
      chatId: CHAT_C,
      rawStartTurn: 31,
      detailTurnCount: 20,
    });
    assert.deepEqual(detail.missingTurns, [15]);
    assert.ok(!detail.text.includes("[T15]"));
  });

  it("searches old summaries with a rare query token and links the original turns", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "What did Oscar promise about the silver key?",
      sceneText: "silver key at the harbor",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0]?.turnStart, 1);
    assert.equal(result.hits[0]?.turnEnd, 5);
    assert.match(result.text, /\[T1~5\]/);
    assert.match(result.text, /\[T1\] USER \(message \d+, chars \d+-\d+\):/);
    assert.match(result.text, /\[T1\] ASSISTANT \(message \d+, chars \d+-\d+\):/);
    assert.ok(result.hits[0]?.original[0]?.userMessageId);
    assert.ok(result.hits[0]?.originalSpans.length > 0);
    assert.ok(result.hits[0]?.originalExcerpt.length > 0);
    assert.ok(result.chars <= B63_PAST_SEARCH_MAX_CHARS);
  });

  it("uses a current-scene cue even when the question is generic", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "what happened before?",
      sceneText: "silver key at the harbor",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0]?.turnStart, 1);
  });

  it("does not inject a record for a recurring character name alone", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "Oscar",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(result.hits.length, 0);
    assert.equal(result.text, "");
  });

  it("returns nothing for an unrelated query or another chat", () => {
    const unrelated = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "weather report",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(unrelated.hits.length, 0);
    const otherChat = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "green door",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(otherChat.hits.length, 0);
  });

  it("excludes inactive, closed-branch, detail, and RAW ranges", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_A,
      query: "red door blue door Turn 20 Turn 35",
      excludeRanges: [
        { start: 11, end: 30 },
        { start: 31, end: 36 },
      ],
    });
    assert.equal(result.hits.length, 0);
  });

  it("delivers 20 detail turns at 450 and 500 chars within final caps", () => {
    for (const [chatId, bodyChars] of [
      [CHAT_D, 450],
      [CHAT_E, 500],
    ] as const) {
      const detail = buildRecentTurnDetailProjection({ chatId, rawStartTurn: 95 });
      assert.equal(detail.blocks.length, 20);
      assert.deepEqual(detail.coveredTurns, Array.from({ length: 20 }, (_, i) => 75 + i));
      assert.deepEqual(detail.deliveredDetailTurns, Array.from({ length: 20 }, (_, i) => 75 + i));
      assert.deepEqual(detail.missingTurns, []);
      assert.deepEqual(detail.omittedTurns, []);
      assert.equal(detail.coverageComplete, true);
      assert.equal(detail.targetMet, true);
      assert.ok(detail.chars >= bodyChars * 20);
      assert.ok(detail.chars <= B63_RECENT_DETAIL_MAX_CHARS);
      assert.ok(detail.estimatedTokens <= B63_RECENT_DETAIL_MAX_TOKENS);
    }
  });

  it("counts header, labels, and newlines in a tiny detail cap", () => {
    const detail = buildRecentTurnDetailProjection({
      chatId: CHAT_L,
      rawStartTurn: 76,
      detailTurnCount: 1,
      maxChars: 107,
      maxTokens: 100000,
    });
    assert.ok(detail.chars <= 107);
    assert.equal(detail.blocks.length, 0);
    assert.deepEqual(detail.omittedTurns, [75]);
    assert.deepEqual(detail.missingTurns, []);
    assert.equal(detail.coverageComplete, false);
    assert.equal(detail.budgetLimited, true);
    assert.equal(detail.text, "");
  });

  it("keeps newest detail rows when the budget is tight", () => {
    const detail = buildRecentTurnDetailProjection({
      chatId: CHAT_F,
      rawStartTurn: 95,
      maxChars: 5000,
      maxTokens: 100000,
    });
    assert.ok(detail.blocks.length < 20);
    assert.ok(detail.blocks.some((block) => block.turnStart === 94));
    assert.ok(!detail.blocks.some((block) => block.turnStart === 75));
    assert.deepEqual(detail.missingTurns, []);
    assert.ok(detail.omittedTurns.includes(75));
    assert.ok(!detail.omittedTurns.includes(94));
    assert.equal(detail.coverageComplete, false);
    assert.equal(detail.budgetLimited, true);
    assert.deepEqual(
      detail.coveredTurns,
      detail.blocks.flatMap((block) =>
        Array.from({ length: block.turnEnd - block.turnStart + 1 }, (_, i) => block.turnStart + i)
      ).sort((a, b) => a - b)
    );
    assert.ok(detail.chars <= 5000);
  });

  it("distinguishes unsaved turns from budget-omitted turns", () => {
    const detail = buildRecentTurnDetailProjection({
      chatId: CHAT_G,
      rawStartTurn: 95,
      maxChars: 5000,
      maxTokens: 100000,
    });
    assert.deepEqual(detail.missingTurns, [85]);
    assert.ok(detail.omittedTurns.includes(75));
    assert.ok(!detail.omittedTurns.includes(85));
    assert.equal(detail.coverageComplete, false);
  });

  it("includes a 5-turn row straddling detailStart and excludes it from Global", async () => {
    const detail = buildRecentTurnDetailProjection({ chatId: CHAT_H, rawStartTurn: 95 });
    assert.equal(detail.detailStart, 75);
    assert.ok(detail.blocks.some((block) => block.turnStart === 71 && block.turnEnd === 75));
    assert.ok(detail.coveredTurns.includes(71));
    assert.ok(detail.coveredTurns.includes(75));
    assert.deepEqual(detail.missingTurns, []);
    assert.deepEqual(detail.omittedTurns, []);
    assert.equal(detail.coverageComplete, true);

    const injection = await buildMemoryContextForPreview({
      chatId: CHAT_H,
      tier: "free",
      memoryCapacity: 10000,
      userMessage: "무관한 질문",
      modelId: "gemini-3.8-flash",
      provider: "cheaperinference",
      excludeSummaryTurnStartGte: 95,
      comparisonMode: true,
      comparisonDetailTurnCount: 20,
    });
    assert.match(injection.recentDetailText, /\[T71~75\]/);
    assert.doesNotMatch(injection.text, /\[T71~75\]/);
  });

  it("selects a middle original turn and records span provenance", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_I,
      query: "은빛 열쇠 약속",
    });
    assert.equal(result.hits.length, 1);
    assert.ok(result.text.includes("MIDDLE_QUOTE_T18"));
    const hit = result.hits[0]!;
    assert.equal(hit.original.length, 5);
    assert.ok(
      hit.original.some(
        (turn) => turn.turnNumber === 18 && turn.assistant.includes("MIDDLE_QUOTE_T18")
      )
    );
    const span = hit.originalSpans.find(
      (entry) => entry.turnNumber === 18 && entry.text.includes("MIDDLE_QUOTE_T18")
    );
    assert.ok(span);
    assert.ok(span!.messageId != null);
    assert.ok(span!.end > span!.start);
    assert.ok(hit.originalExcerpt.includes("MIDDLE_QUOTE_T18"));
    assert.ok(hit.promptLine.includes("MIDDLE_QUOTE_T18"));
    assert.ok(hit.summary.length >= hit.summaryInPrompt.length);
  });

  it("selects only the query-matched middle turn", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_M,
      query: "은빛 열쇠",
    });
    assert.equal(result.hits.length, 1);
    const hit = result.hits[0]!;
    assert.ok(result.text.includes("은빛 열쇠"));
    assert.ok(hit.originalSpans.length > 0);
    assert.ok(hit.originalSpans.every((span) => span.turnNumber === 18));
    assert.ok(hit.originalSpans.some((span) => span.matchedTokens.length > 0));
  });

  it("selects a late query match in a long message", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_N,
      query: "은빛 열쇠",
    });
    assert.equal(result.hits.length, 1);
    const hit = result.hits[0]!;
    const span = hit.originalSpans.find((entry) => entry.text.includes("은빛 열쇠"));
    assert.ok(span);
    assert.ok(span!.start > 1000);
    assert.ok(result.text.includes("은빛 열쇠"));
  });

  it("keeps a late quote from a long original message in the prompt excerpt", () => {
    const result = searchPastTurnSummaries({
      chatId: CHAT_J,
      query: "은빛 열쇠 약속",
    });
    assert.equal(result.hits.length, 1);
    assert.ok(result.text.includes("LATE_QUOTE_T20"));
    const hit = result.hits[0]!;
    assert.ok(hit.original[0]!.assistant.includes("LATE_QUOTE_T20"));
    const span = hit.originalSpans.find(
      (entry) => entry.role === "assistant" && entry.text.includes("LATE_QUOTE_T20")
    );
    assert.ok(span);
    assert.ok(span!.end > 1000);
    assert.ok(hit.originalExcerpt.includes("LATE_QUOTE_T20"));
  });

  it("excludes fully delivered summaries but keeps partially covered records", () => {
    const covered = searchPastTurnSummaries({
      chatId: CHAT_K,
      query: "은빛 열쇠 약속 항구 등대",
      excludeCoveredRanges: [{ start: 75, end: 85 }],
    });
    assert.equal(covered.hits.length, 1);
    assert.equal(covered.hits[0]?.turnStart, 86);

    const partial = searchPastTurnSummaries({
      chatId: CHAT_K,
      query: "은빛 열쇠 약속 항구 등대",
      excludeCoveredRanges: [{ start: 80, end: 85 }],
    });
    assert.ok(partial.hits.some((hit) => hit.turnStart === 75));
    assert.ok(partial.hits.some((hit) => hit.turnStart === 86));

    const kept = listPromptInjectibleMemoryRecords(CHAT_K, {
      excludeCoveredRanges: [{ start: 80, end: 85 }],
    });
    assert.ok(kept.some((record) => record.turnStart === 75));
    const dropped = listPromptInjectibleMemoryRecords(CHAT_K, {
      excludeCoveredRanges: [{ start: 75, end: 85 }],
    });
    assert.ok(!dropped.some((record) => record.turnStart === 75));
  });

  it("keeps omitted detail turns in Global instead of treating nominal detail as delivered", () => {
    const partial = resolveGlobalCurrentMemory(CHAT_K, 10000, {
      excludeTurnStartGte: 95,
      excludeCoveredRanges: [{ start: 75, end: 85 }],
    });
    assert.match(partial.text, /\[86~90턴\]/);
    assert.doesNotMatch(partial.text, /\[75~85턴\]/);

    const full = resolveGlobalCurrentMemory(CHAT_K, 10000, {
      excludeTurnStartGte: 95,
      excludeCoveredRanges: [{ start: 75, end: 90 }],
    });
    assert.equal(full.text, "");
  });

  it("keeps the operational RAW4/10k default when comparison is off", () => {
    const longHistory: { role: "user" | "assistant"; content: string }[] = Array.from(
      { length: 12 },
      (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "긴 문장 ".repeat(600),
      })
    );
    const built = buildContext({
      charName: "오스카",
      chunks: [],
      userNickname: "제이",
      userPersona: "제이",
      personaDisplayName: "제이",
      shortTermHistory: longHistory,
      currentUserMessage: "continue",
      nsfw: false,
      modelId: "gemini-3.8-flash",
      provider: "cheaperinference",
      narrativePov: "third_person_limited",
    });
    assert.equal(built.history.length, 9);
    assert.doesNotMatch(built.systemPrompt, /\[최근 20턴 상세 기억/);
    assert.doesNotMatch(built.systemPrompt, /\[과거 기억 검색/);
  });

  it("keeps six RAW exchanges and injects detail/search in dynamic sections", async () => {
    const injection = await buildMemoryContextForPreview({
      chatId: CHAT_A,
      tier: "free",
      memoryCapacity: 10000,
      userMessage: "What did Oscar promise about the silver key?",
      modelId: "gemini-3.8-flash",
      provider: "cheaperinference",
      excludeSummaryTurnStartGte: 31,
      comparisonMode: true,
      comparisonDetailTurnCount: 20,
      comparisonSceneText: "silver key at the harbor",
    });
    assert.match(injection.recentDetailText, /^\[최근 20턴 상세 기억 — T11~30\]/);
    assert.match(injection.pastSearchText, /\[T1~5\]/);
    assert.doesNotMatch(injection.text, /\[T11~/);
    assert.doesNotMatch(injection.pastSearchText, /\[T11\]/);
    assert.doesNotMatch(injection.pastSearchText, /\[T31\]/);

    const built = buildContext({
      charName: "오스카",
      chunks: [],
      userNickname: "제이",
      userPersona: "제이",
      personaDisplayName: "제이",
      shortTermHistory: rawHistory(),
      currentUserMessage: "What did Oscar promise about the silver key?",
      nsfw: false,
      longTermMemory: injection.text,
      mediumTermMemoryBlock: injection.mediumTermText,
      recentDetailMemoryBlock: injection.recentDetailText,
      pastSearchMemoryBlock: injection.pastSearchText,
      modelId: "gemini-3.8-flash",
      provider: "cheaperinference",
      narrativePov: "third_person_limited",
      comparisonRawExchanges: 6,
      comparisonHistoryTokenBudget: 20000,
    });
    assert.equal(built.history.length, 13);
    assert.match(built.history[0]?.content ?? "", /^User turn 31/);
    assert.match(built.history[11]?.content ?? "", /^Assistant turn 36/);
    assert.match(built.history[12]?.content ?? "", /What did Oscar promise/);
    assert.match(built.systemPrompt, /\[최근 20턴 상세 기억/);
    assert.match(built.systemPrompt, /\[과거 기억 검색/);
  });

});
