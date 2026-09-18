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
  DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES,
  RAW_HISTORY_COMPLETE_EXCHANGES,
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveMemoryCoverageGap,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { trimProviderHistoryToBudget } from "@/lib/providerHistoryPolicy";
import {
  executeAtomicVariantSwitchCore,
  getAssistantSourceTurn,
  hasLaterMessageAfter,
  isCanonicalFrontierAssistantMessage,
} from "@/lib/rpDerivedStateLifecycle";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { scheduleMemoryUpdate } from "./memory-manager";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import { loadMemoryEligibleChatTurnsWithMessageIds } from "./memory-turn-loader";
import {
  __setSummarizeTurnBatchCallerForTests,
  ensureSummaryBarrier,
  prepareNonBlockingSummaryForMainRp,
} from "./memory-rolling-summary";

const BASE_CHAT = 944200;
const BASE_USER = 944201;
const BASE_CHAR = 944202;
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
    `ds-${userId}@test.local`,
    "ds",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, "DeferredChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  getOrCreateChatMemory(chatId, userId, charId, "free");
}

/** Greeting + N canonical playable turns (turn 1..N), returns assistant ids per turn. */
function seedPlayableTurns(
  chatId: number,
  userId: number,
  charId: number,
  count: number
): number[] {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
  ).run(chatId, "assistant", "인사.", "greeting");
  const assistantIds: number[] = [];
  for (let t = 1; t <= count; t++) {
    const userIdMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(chatId, "user", `본편 턴 ${t}`).lastInsertRowid as number;
    const assistantId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
      )
      .run(chatId, "assistant", `응답 ${t} 대사`, "test", userIdMsgId).lastInsertRowid as number;
    assistantIds.push(assistantId);
  }
  updateChatMemory(chatId, userId, charId, { message_count: count, summarized_turn_count: 0 });
  return assistantIds;
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
  charName: "DeferredChar",
  tier: "free" as const,
  memoryCapacity: 8000,
  completedTurns,
});

const scheduleMemoryOpts = (chatId: number, userId: number, charId: number) => ({
  chatId,
  userId,
  characterId: charId,
  relationshipNames: { charName: "DeferredChar", userName: "tester" },
  tier: "free" as const,
  memoryCapacity: 8000,
  userMessage: "본편 턴 5",
  assistantMessage: "응답 5 대사",
  sourceUserMessageId: null,
  userPersona: null,
  route: "safe" as const,
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
  for (let i = BASE_CHAT; i <= BASE_CHAT + testSeq + 1; i++) {
    getDb().prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(i);
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(i);
  }
});

describe("deferred rolling-summary seal + canonical frontier freeze", () => {
  it("RACE A — regen/variant switch at 5-turn frontier keeps summary record absent", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const assistantIds = seedPlayableTurns(chat, user, char, 5);
    let summaryCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      summaryCalls += 1;
      return { text: MOCK_SUMMARY };
    });

    // Regen path (regenerated assistant at frontier) — deferred seal fires nothing.
    await scheduleMemoryUpdate({
      ...scheduleMemoryOpts(chat, user, char),
      assistantMessageId: assistantIds[4]!,
      isRegenerate: true,
      previousAssistantMessage: "응답 5 regen 이전 대사",
      assistantMessage: "응답 5 regen 대사",
    });
    assert.equal(summaryCalls, 0, "frontier regen must not trigger summary provider call");
    assert.equal(
      listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length,
      0,
      "no summary record while frontier is regen/variant mutable"
    );

    // Variant A/B switch on the frontier assistant (nonnumeric wrapper).
    const db = getDb();
    const variants = [
      { content: "버전 A", model: "test", usage: null, created_at: "" },
      { content: "버전 B", model: "test", usage: null, created_at: "" },
    ];
    executeAtomicVariantSwitchCore(db, {
      chatId: chat,
      messageId: assistantIds[4]!,
      content: "버전 B",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      variantsJson: JSON.stringify(variants),
      variantIndex: 1,
      sourceTurn: getAssistantSourceTurn(db, chat, assistantIds[4]!) ?? 0,
      characterId: char,
      userId: user,
      selectedFacts: [],
      selectedRequestId: null,
      selectedGenerationSequence: null,
    });
    assert.equal(summaryCalls, 0, "A/B switch must not trigger summary provider call");
    assert.equal(
      listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length,
      0,
      "summary record still absent after switch"
    );
  });

  it("RACE B — next user persist moves the frontier; canonical assistant is immutable", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const assistantIds = seedPlayableTurns(chat, user, char, 5);
    const db = getDb();

    // Before TURN 6 user row: TURN 5 assistant is the canonical frontier.
    assert.equal(isCanonicalFrontierAssistantMessage(db, chat, assistantIds[4]!), true);

    // TURN 6 user message canonically accepted (persisted first, assistant pending).
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    ).run(chat, "user", "TURN 6 유저 입력");
    assert.equal(hasLaterMessageAfter(db, chat, assistantIds[4]!), true);
    assert.equal(
      isCanonicalFrontierAssistantMessage(db, chat, assistantIds[4]!),
      false,
      "TURN 5 is immutable once the TURN 6 user row persists"
    );
    // Server guard semantics for RACE B — frontier-moved switch must 409.
    const frontierMoved = !isCanonicalFrontierAssistantMessage(db, chat, assistantIds[4]!);
    assert.equal(frontierMoved, true);
  });

  it("RACE C — TURN 6 start with 1~5 summary pending: RAW pool 5, all exchanges present, gap 0", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 5);

    const summarizedThrough = highestContiguousCompletedTurn(
      listMemoryRecordsForChat(chat),
      5
    );
    assert.equal(summarizedThrough, 0, "deferred seal keeps 1~5 unsealed at TURN 6 start");

    const completedTurns = 5;
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount: summarizedThrough,
    });
    assert.equal(pool, 5, "deferred boundary expands provider RAW pool to 5 exchanges");

    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, completedTurns));
    assert.equal(prep.catchUpScheduled, true, "background catch-up starts at TURN 6");

    const firstRawPlayableTurn = completedTurns - pool + 1;
    const gap = resolveMemoryCoverageGap({ firstRawPlayableTurn, summarizedTurnCount: summarizedThrough });
    assert.equal(gap, 0, "no middle memory hole: firstRawPlayableTurn <= summarizedThrough + 1");
  });

  it("RACE D — RAW1~5 over HISTORY_TOKEN_BUDGET: deferred boundary keeps 5 complete exchanges, gap 0", () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 5);

    const summarizedThrough = 0;
    const completedTurns = 5;
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount: summarizedThrough,
    });
    assert.equal(pool, 5);

    const floor = resolveProviderRawTrimFloorExchanges(completedTurns - summarizedThrough);
    assert.equal(floor, DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES, "deferred boundary floor raises to 5");

    const turns: DialogueTurn[] = Array.from({ length: 5 }, (_, i) => ({
      user: `u${i + 1}:${"가".repeat(250)}`,
      assistant: `a${i + 1}:${"나".repeat(2500)}`,
    }));
    const full = rawRecentTurnsToHistory(turns, pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: summarizedThrough,
    });
    const overBudget = full.reduce(
      (sum, m) => sum + m.content.length,
      0
    );
    assert.ok(overBudget > HISTORY_TOKEN_BUDGET, "fixture must exceed the 10K token soft budget");

    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: floor,
      protectOpening: false,
    });
    assert.equal(countPlayableHistoryTurns(trimmed), 5, "all 5 unsummarized exchanges survive trim");
    const firstRawPlayableTurn = completedTurns - countPlayableHistoryTurns(trimmed) + 1;
    assert.equal(
      resolveMemoryCoverageGap({ firstRawPlayableTurn, summarizedTurnCount: summarizedThrough }),
      0,
      "gap stays 0 even beyond the soft budget"
    );
  });

  it("RACE E — after 1~5 summary commit, next request returns to normal RAW4 with gap 0", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 6);

    let summaryCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      summaryCalls += 1;
      return { text: MOCK_SUMMARY };
    });
    // Turn 6 starts (raw pending state), catch-up seals 1~5 in background.
    const prep = prepareNonBlockingSummaryForMainRp(prepOpts(chat, user, char, 5));
    assert.equal(prep.catchUpScheduled, true);
    for (let i = 0; i < 60; i++) {
      if (
        listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length > 0
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(summaryCalls >= 1, "catch-up sealed 1~5");
    assert.equal(
      listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length,
      1,
      "summary record covering 1~5 committed"
    );

    // Next request: TURN 6 completed → 6 eligible completed turns, frontier 1~5 sealed.
    const summarized = highestContiguousCompletedTurn(listMemoryRecordsForChat(chat), 6);
    assert.equal(summarized, 5);
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 6,
      summarizedTurnCount: summarized,
    });
    assert.equal(
      pool,
      RAW_HISTORY_COMPLETE_EXCHANGES,
      "normal RAW4 pool restored once summary covers 1~5"
    );
    const floor = resolveProviderRawTrimFloorExchanges(6 - summarized);
    assert.equal(floor, RAW_HISTORY_COMPLETE_EXCHANGES, "floor back to RAW4");
    const firstRawPlayableTurn = 6 - pool + 1;
    assert.equal(
      resolveMemoryCoverageGap({ firstRawPlayableTurn, summarizedTurnCount: summarized }),
      0,
      "summary 1~5 + RAW(5~6): no gap"
    );
  });

  it("RACE F — catch-up failure at backlog: barrier retries via existing owner; no silent RAW4 shrink", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    seedPlayableTurns(chat, user, char, 7);

    let attempts = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      attempts += 1;
      throw new Error("provider down");
    });

    const summarizedThrough = 0;
    const completedTurns = 7;
    const unsummarized = completedTurns - summarizedThrough;
    assert.ok(unsummarized > RAW_HISTORY_COMPLETE_EXCHANGES + 1, "backlog crosses barrier threshold");

    const barrier = await ensureSummaryBarrier({
      ...prepOpts(chat, user, char, completedTurns),
    });
    assert.equal(barrier.ok, false, "existing barrier reports coverage failure (no new retry system)");
    assert.ok(attempts >= 1, "barrier invoked the existing catch-up/seal owner despite failure");

    const floor = resolveProviderRawTrimFloorExchanges(unsummarized);
    assert.equal(
      floor,
      DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES,
      "failure path keeps the bounded floor — never silently shrinks to RAW4"
    );
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount: summarizedThrough,
    });
    assert.equal(pool, unsummarized, "RAW pool keeps the full unsummarized suffix (source in DB)");

    const turns: DialogueTurn[] = Array.from({ length: 7 }, (_, i) => ({
      user: `u${i + 1}:${"가".repeat(230)}`,
      assistant: `a${i + 1}:${"나".repeat(2300)}`,
    }));
    const full = rawRecentTurnsToHistory(turns, pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: summarizedThrough,
    });
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: floor,
      protectOpening: false,
    });
    assert.ok(
      countPlayableHistoryTurns(trimmed) >= DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES,
      "trim keeps at least the bounded 5 exchanges even under budget pressure"
    );
  });

  it("RACE G — all context tracks share one coverage-floor owner", () => {
    const summarizedThrough = 0;
    const completedTurns = 5;
    const unsummarized = completedTurns - summarizedThrough;
    const floor = resolveProviderRawTrimFloorExchanges(unsummarized);
    const floorBound = DEFERRED_SUMMARY_RAW_COVERAGE_EXCHANGES;
    assert.ok(
      floor >= RAW_HISTORY_COMPLETE_EXCHANGES && floor <= floorBound,
      "primary/fallback/adult-handoff/context tracks read the same bounded floor"
    );
    assert.equal(floor, floorBound);
  });

  it("RACE H — repeated frontier regens fire zero rolling-summary provider calls", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const assistantIds = seedPlayableTurns(chat, user, char, 5);
    let summaryCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      summaryCalls += 1;
      return { text: MOCK_SUMMARY };
    });

    for (let i = 0; i < 4; i++) {
      await scheduleMemoryUpdate({
        ...scheduleMemoryOpts(chat, user, char),
        assistantMessageId: assistantIds[4]!,
        isRegenerate: true,
        previousAssistantMessage: `응답 5 regen${i} 이전`,
        assistantMessage: `응답 5 regen${i + 1} 대사`,
      });
    }
    assert.equal(
      summaryCalls,
      0,
      "no summary provider call per frontier regen (deferred seal)"
    );
  });

  it("RACE I — TURN 6 summary treats the final active TURN 5 variant as its only source", async () => {
    const { chat, user, char } = ids();
    seed(chat, user, char);
    const assistantIds = seedPlayableTurns(chat, user, char, 5);
    const db = getDb();

    // User selects variant B at the frontier; freeze then protects it.
    const variants = [
      { content: "응답 5 버전 A", model: "test", usage: null, created_at: "" },
      { content: "응답 5 버전 B (선택됨)", model: "test", usage: null, created_at: "" },
    ];
    executeAtomicVariantSwitchCore(db, {
      chatId: chat,
      messageId: assistantIds[4]!,
      content: "응답 5 버전 B (선택됨)",
      model: "test",
      usageJson: null,
      adultRouteMetaJson: "",
      variantsJson: JSON.stringify(variants),
      variantIndex: 1,
      sourceTurn: getAssistantSourceTurn(db, chat, assistantIds[4]!) ?? 0,
      characterId: char,
      userId: user,
      selectedFacts: [],
      selectedRequestId: null,
      selectedGenerationSequence: null,
    });

    // TURN 6 user persists → frontier frozen → summary source is immutable canonical content.
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    ).run(chat, "user", "TURN 6 유저 입력");
    assert.equal(isCanonicalFrontierAssistantMessage(db, chat, assistantIds[4]!), false);

    const turns = loadMemoryEligibleChatTurnsWithMessageIds(chat);
    const turn5 = turns.find((t) => t.turnNumber === 5);
    assert.equal(
      turn5?.assistant,
      "응답 5 버전 B (선택됨)",
      "summary catch-up reads the last selected active variant"
    );
  });

  it("deferred boundary pool/floor policy matrix", () => {
    // unsummarized <= 4: normal RAW4
    assert.equal(resolveProviderRawTrimFloorExchanges(0), RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.equal(resolveProviderRawTrimFloorExchanges(4), RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 9,
        summarizedTurnCount: 5,
      }),
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
    // unsummarized == 5: RAW5 hard coverage + nonblocking catch-up
    assert.equal(resolveProviderRawTrimFloorExchanges(5), 5);
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 5,
        summarizedTurnCount: 0,
      }),
      5
    );
    // unsummarized > 5: barrier/catch-up; floor bounded at 5 (never scales with backlog)
    assert.equal(resolveProviderRawTrimFloorExchanges(6), 5);
    assert.equal(resolveProviderRawTrimFloorExchanges(9), 5);
    assert.equal(resolveProviderRawTrimFloorExchanges(40), 5);
    assert.equal(
      resolveProviderRawPoolExchangeCount({
        memoryFeatureEnabled: true,
        completedTurns: 40,
        summarizedTurnCount: 35,
      }),
      5
    );
  });

  it("no middle memory hole at deferred boundary even with over-budget turns", () => {
    const summarizedThrough = 0;
    const completedTurns = 5;
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount: summarizedThrough,
    });
    const floor = resolveProviderRawTrimFloorExchanges(completedTurns - summarizedThrough);
    assert.equal(pool, 5);
    assert.equal(floor, 5);

    const turns: DialogueTurn[] = Array.from({ length: 5 }, (_, i) => ({
      user: `user turn ${i + 1}:${"가".repeat(300)}`,
      assistant: `assistant turn ${i + 1}:${"나".repeat(2600)}`,
    }));
    const full = rawRecentTurnsToHistory(turns, pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: summarizedThrough,
    });
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: floor,
      protectOpening: false,
    });
    const keptTurns = countPlayableHistoryTurns(trimmed);
    assert.equal(keptTurns, 5);
    const firstRawPlayableTurn = completedTurns - keptTurns + 1;
    assert.equal(
      resolveMemoryCoverageGap({
        firstRawPlayableTurn,
        summarizedTurnCount: summarizedThrough,
      }),
      0,
      "firstRawPlayableTurn (1) <= summarizedThrough (0) + 1"
    );
  });
});
