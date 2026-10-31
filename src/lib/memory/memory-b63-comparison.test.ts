import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory } from "./memory-db";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  B63_PAST_SEARCH_MAX_CHARS,
  B63_RECENT_DETAIL_MAX_CHARS,
  buildRecentTurnDetailProjection,
  searchPastTurnSummaries,
} from "./memory-b63-comparison";
import { buildMemoryContextForPreview } from "./memory-manager";
import { buildContext } from "@/services/contextBuilder";

const USER = 99001;
const CHAR = 99002;
const CHAT_A = 99010;
const CHAT_B = 99011;
const CHAT_C = 99012;
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
  for (const chatId of [CHAT_A, CHAT_B, CHAT_C]) insertChat(chatId);
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
    assert.match(result.text, /\[T1\] USER:/);
    assert.match(result.text, /\[T1\] ASSISTANT:/);
    assert.ok(result.hits[0]?.original[0]?.userMessageId);
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
