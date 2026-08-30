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
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { trimProviderHistoryToBudget } from "@/lib/providerHistoryPolicy";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  catchUpRollingSummaries,
  isRollingSummaryInFlight,
  prepareNonBlockingSummaryForMainRp,
  scheduleSummaryCatchUpDurable,
} from "./memory-rolling-summary";

const BASE_CHAT = 932810;
const BASE_USER = 932811;
const BASE_CHAR = 932812;
let testSeq = 0;

function ids() {
  testSeq += 1;
  return { chat: BASE_CHAT + testSeq, user: BASE_USER + testSeq, char: BASE_CHAR + testSeq };
}

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

const ENV_MEMORY = "MEMORY_FEATURE_ENABLED";
let savedEnv: Record<string, string | undefined>;

function cleanup(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare("DELETE FROM characters WHERE id=?").run(charId);
}

function seed(chatId: number, userId: number, charId: number) {
  cleanup(chatId, userId, charId);
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    userId,
    `nb-${userId}@test.local`,
    "nb",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, "NbChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  getOrCreateChatMemory(chatId, userId, charId, "free");
}

function insertMsg(chatId: number, role: "user" | "assistant", content: string, model = "test") {
  getDb()
    .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
    .run(chatId, role, content, role === "assistant" ? model : "user");
}

function seedPlayableTurns(chatId: number, userId: number, charId: number, count: number) {
  getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  insertMsg(chatId, "assistant", "인사.", "greeting");
  for (let t = 1; t <= count; t++) {
    insertMsg(chatId, "user", `본편 턴 ${t}`);
    insertMsg(chatId, "assistant", `응답 ${t}`);
  }
  updateChatMemory(chatId, userId, charId, { message_count: count, summarized_turn_count: 0 });
}

function sealThroughTurn5(chatId: number, userId: number, charId: number) {
  const r = persistValidatedSummaryBatch({
    chatId,
    userId,
    characterId: charId,
    tier: "free",
    turnStart: 1,
    assistantMessageId: null,
    summary: MOCK_SUMMARY,
    summaryKind: "main_canon",
    scopePayload: {
      v: 1,
      scopes: { main_canon: MOCK_SUMMARY },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
    },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    playableTurnCount: 5,
  });
  assert.equal(r.ok, true);
  updateChatMemory(chatId, userId, charId, { summarized_turn_count: 5, message_count: 5 });
}

function sealBatch(
  chatId: number,
  userId: number,
  charId: number,
  start: number,
  end: number,
  playableTurnCount: number
) {
  const r = persistValidatedSummaryBatch({
    chatId,
    userId,
    characterId: charId,
    tier: "free",
    turnStart: start,
    assistantMessageId: null,
    summary: MOCK_SUMMARY,
    summaryKind: "main_canon",
    scopePayload: {
      v: 1,
      scopes: { main_canon: MOCK_SUMMARY },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
    },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    playableTurnCount,
  });
  assert.equal(r.ok, true);
}

const prepOpts = (
  chatId: number,
  userId: number,
  charId: number,
  completedTurns: number
) => ({
  chatId,
  userId,
  characterId: charId,
  charName: "NbChar",
  tier: "free" as const,
  memoryCapacity: 8000,
  completedTurns,
});

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  savedEnv = { [ENV_MEMORY]: process.env[ENV_MEMORY] };
  process.env[ENV_MEMORY] = "1";
});
afterEach(async () => {
  __setSummarizeTurnBatchCallerForTests(null);
  if (savedEnv) {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
after(() => {
  for (let i = BASE_CHAT + 1; i <= BASE_CHAT + testSeq + 1; i++) {
    getDb().prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(i);
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(i);
  }
});


describe("Phase 3-A non-blocking summary", () => {
  it("TEST 1 — summary pending: main prep does not await summary completion", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 18);
    sealThroughTurn5(chat, user, char);
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 200));
      return { text: MOCK_SUMMARY };
    });

    const started = Date.now();
    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, 18));
    const elapsed = Date.now() - started;

    assert.equal(prep.summarizedThrough, 5);
    assert.equal(prep.unsummarizedTurns, 13);
    assert.ok(prep.pendingRange?.startsWith("6~"));
    assert.equal(prep.catchUpScheduled, true);
    assert.ok(elapsed < 100, `prep must not await summary LLM (${elapsed}ms)`);

    await new Promise((r) => setTimeout(r, 400));
    assert.ok(calls >= 1, "background catch-up should invoke summary LLM");
  });

  it("TEST 2 — slow summary: RP path start is not blocked by 60s summary mock", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 5);
    __setSummarizeTurnBatchCallerForTests(async () => {
      await new Promise((r) => setTimeout(r, 60_000));
      return { text: MOCK_SUMMARY };
    });

    const rpStart = Date.now();
    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, 5));
    const rpElapsed = Date.now() - rpStart;

    assert.ok(rpElapsed < 500, `RP prep blocked ${rpElapsed}ms`);
    assert.equal(prep.catchUpScheduled, true);
  });

  it("TEST 3 — summary failure: prep succeeds; catch-up returns false without throwing", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 5);
    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("provider down");
    });

    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, 5));
    assert.equal(prep.summarizedThrough, 0);
    assert.equal(prep.catchUpScheduled, true);

    for (let i = 0; i < 40 && isRollingSummaryInFlight(chat); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length, 0);
    assert.equal(isRollingSummaryInFlight(chat), false);
  });

  it("TEST 4 — unsummarized raw source retained; provider injection bounded by budget", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 18);
    sealBatch(chat, user, char, 1, 5, 10);

    const summarized = highestContiguousCompletedTurn(listMemoryRecordsForChat(chat), 18);
    assert.equal(summarized, 5);

    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 18,
      summarizedTurnCount: summarized,
    });
    assert.equal(pool, 13);

    const turns: DialogueTurn[] = Array.from({ length: 18 }, (_, i) => ({
      user: `u${i + 1}:${"가".repeat(200)}`,
      assistant: `a${i + 1}:${"나".repeat(2500)}`,
    }));
    const full = rawRecentTurnsToHistory(turns, pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: summarized,
    });
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: resolveProviderRawTrimFloorExchanges(),
      protectOpening: false,
    });
    assert.ok(countPlayableHistoryTurns(trimmed) < pool);
    assert.ok(countPlayableHistoryTurns(trimmed) >= RAW_HISTORY_COMPLETE_EXCHANGES);
    const dbRows = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM messages WHERE chat_id=? AND role='user'`)
      .get(chat) as { c: number };
    assert.ok(dbRows.c >= 18, "source messages retained in DB");
  });

  it("TEST 5 — concurrent requests: same range active LLM calls <= 1", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 5);
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 80));
      return { text: MOCK_SUMMARY };
    });

    scheduleSummaryCatchUpDurable(prepOpts(chat, user, char, 5));
    scheduleSummaryCatchUpDurable(prepOpts(chat, user, char, 5));

    await new Promise((r) => setTimeout(r, 250));
    assert.equal(calls, 1);
    assert.equal(listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length, 1);
  });

  it("TEST 6 — backlog: catch-up oldest-first without skipping ranges", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 18);
    let callCount = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      callCount += 1;
      return { text: MOCK_SUMMARY };
    });

    const processed = await catchUpRollingSummaries({
      ...prepOpts(chat, user, char, 18),
      maxRounds: 3,
    });
    assert.equal(processed, 3);
    assert.equal(callCount, 3);

    const records = listMemoryRecordsForChat(chat)
      .filter((r) => !r.inactive)
      .sort((a, b) => a.turnStart - b.turnStart);
    assert.deepEqual(
      records.map((r) => r.turnStart),
      [1, 6, 11]
    );
    assert.equal(highestContiguousCompletedTurn(records, 18), 15);
  });

  it("TEST 10 — summary provider failure: chat prep succeeds; source retained; bounded injection", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 18);
    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("provider down");
    });

    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, 18));
    assert.equal(prep.catchUpScheduled, true);

    for (let i = 0; i < 40 && isRollingSummaryInFlight(chat); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 18,
      summarizedTurnCount: prep.summarizedThrough,
    });
    const turns: DialogueTurn[] = Array.from({ length: 18 }, (_, i) => ({
      user: `u${i + 1}:${"가".repeat(200)}`,
      assistant: `a${i + 1}:${"나".repeat(2500)}`,
    }));
    const trimmed = trimProviderHistoryToBudget(
      rawRecentTurnsToHistory(turns, pool, {
        memoryFeatureEnabled: true,
        summarizedTurnCount: prep.summarizedThrough,
      }),
      HISTORY_TOKEN_BUDGET,
      { minRealPlayableExchanges: resolveProviderRawTrimFloorExchanges(), protectOpening: false }
    );
    assert.ok(countPlayableHistoryTurns(trimmed) < pool);
    const dbRows = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM messages WHERE chat_id=? AND role='user'`)
      .get(chat) as { c: number };
    assert.ok(dbRows.c >= 18);
    assert.equal(listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length, 0);
  });

  it("TEST 11 — restart recovery: pending backlog catch-up without duplicate commits", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 18);
    sealThroughTurn5(chat, user, char);

    let callCount = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      callCount += 1;
      return { text: MOCK_SUMMARY };
    });

    const round1 = await catchUpRollingSummaries({
      ...prepOpts(chat, user, char, 18),
      maxRounds: 1,
    });
    assert.equal(round1, 1);
    assert.equal(callCount, 1);

    const round2 = await catchUpRollingSummaries({
      ...prepOpts(chat, user, char, 18),
      maxRounds: 2,
    });
    assert.equal(round2, 1);
    assert.equal(callCount, 2);

    const records = listMemoryRecordsForChat(chat)
      .filter((r) => !r.inactive)
      .sort((a, b) => a.turnStart - b.turnStart);
    assert.deepEqual(
      records.map((r) => r.turnStart),
      [1, 6, 11]
    );
    assert.equal(highestContiguousCompletedTurn(records, 18), 15);
  });
});
