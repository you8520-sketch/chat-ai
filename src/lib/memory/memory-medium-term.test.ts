/**
 * Medium-term memory reader — zero provider calls.
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
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { buildMemoryContextForChat, updateLorebookForChat } from "./memory-manager";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import {
  __setCompactCurrentMemoryTestOverride,
  compactCurrentMemory,
} from "./memory-rolling-summary";
import {
  buildMediumTermMemoryBlock,
  buildMediumTermMemoryBlockForProjection,
  listMediumTermEligibleRecords,
  measureMediumGlobalLiteralDuplicateChars,
  rawOwnedTurnStart,
  shouldInjectMediumTermMemory,
} from "./memory-medium-term";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  closeActiveBranchCanon,
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  promoteRecordsToBranchCanon,
  reopenClosedBranchCanon,
  updateMemoryRecordById,
} from "./memory-turn-summary";
import { buildContext } from "@/services/contextBuilder";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import { emergencyFallbackTrimLorebookSync } from "./memory-global-projection";

const CHAT = 996001;
const USER = 996002;
const CHAR = 996003;

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
}

function seedChat(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `medium-${USER}@test.local`,
    "medium-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "MediumChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function padBody(marker: string, chars = 420): string {
  let body = `${marker} → event → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function insertBlocks(count: number): void {
  const db = getDb();
  for (let i = 0; i < count; i++) {
    const turnStart = i * ROLLING_SUMMARY_INTERVAL + 1;
    const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
       VALUES (?,?,?,?,?)`
    ).run(CHAT, turnStart, turnEnd, padBody(`BLOCK_${turnStart}`), "main_canon");
  }
}

function insertMovingHorizonFixture(currentTurn: number): void {
  const db = getDb();
  const summarizedThrough =
    Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const detailTurns = {
    near: currentTurn - 20,
    mid: currentTurn - 40,
    far: currentTurn - 70,
  };
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= summarizedThrough;
    start += ROLLING_SUMMARY_INTERVAL
  ) {
    const turnEnd = start + ROLLING_SUMMARY_INTERVAL - 1;
    let marker = `FILLER_${start}`;
    if (start === 16) marker = "OLD_MAJOR_EVENT";
    if (detailTurns.near >= start && detailTurns.near <= turnEnd) marker = "NEAR_MEDIUM_DETAIL";
    if (detailTurns.mid >= start && detailTurns.mid <= turnEnd) marker = "MID_MEDIUM_DETAIL";
    if (detailTurns.far >= start && detailTurns.far <= turnEnd) marker = "FAR_MEDIUM_DETAIL";
    const recentAnchor = Math.max(21, currentTurn - 15);
    const recentStart =
      Math.floor((recentAnchor - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL + 1;
    if (start === recentStart) marker = "RECENT_MAJOR_EVENT";
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
       VALUES (?,?,?,?,?)`
    ).run(CHAT, start, turnEnd, padBody(marker), "main_canon");
  }
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  seedChat();
  process.env.MEMORY_FEATURE_ENABLED = "1";
  __setCompactCurrentMemoryTestOverride(null);
});

afterEach(cleanup);

describe("EXACT GLOBAL DUPLICATION REPRODUCTION", () => {
  it("pre-fix: unconditional medium duplicates exact global bodies — CONFIRMED", () => {
    insertBlocks(10);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "exact");
    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 5,
      excludeTurnStartGte: 100,
    });
    const dup = measureMediumGlobalLiteralDuplicateChars(medium.text, resolved.text);
    assert.ok(dup > 0, "MEDIUM_EXACT_GLOBAL_DUPLICATION = CONFIRMED pre-fix");
  });

  it("post-fix: exact path — zero medium injection and zero prompt delta", async () => {
    insertBlocks(10);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "exact");

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.equal(injection.mediumTermText, "");
    assert.equal(
      measureMediumGlobalLiteralDuplicateChars(injection.mediumTermText, injection.text),
      0
    );

    const built = buildContext({
      charName: "MediumChar",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "hi" }],
      currentUserMessage: "next",
      nsfw: false,
      provider: "openrouter",
      longTermMemory: injection.text,
      mediumTermMemoryBlock: injection.mediumTermText,
    });
    const ids = built.meta.trackedSections?.map((section) => section.id) ?? [];
    assert.equal(ids.includes("medium-term-memory"), false);
  });
});

describe("MEDIUM ACTIVATION", () => {
  it("failure_fallback — medium OFF (prefer-recent emergency window already owns recent blocks)", async () => {
    insertBlocks(60);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const fallback = emergencyFallbackTrimLorebookSync(rebuilt, MEMORY_CAPACITY_FIXED);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: fallback, membership_tier: "free" });
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: fallback,
    });
    assert.equal(resolved.projectionKind, "failure_fallback");
    assert.equal(shouldInjectMediumTermMemory(resolved.projectionKind), false);

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.equal(injection.mediumTermText, "");
  });

  it("global_compact — medium ON and recovers moving details", async () => {
    insertMovingHorizonFixture(300);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    __setCompactCurrentMemoryTestOverride(async (_input, maxChars) =>
      [
        "OLD_MAJOR_EVENT preserved",
        "MID_MAJOR_EVENT preserved",
        "RECENT_MAJOR_EVENT preserved",
        "compressed fold without granular near/mid/far chronological details",
      ]
        .join(" → ")
        .slice(0, maxChars)
    );
    const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: compacted, membership_tier: "free" });

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: compacted,
    });
    assert.equal(resolved.projectionKind, "global_compact");

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
      modelId: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
    });
    assert.ok(injection.mediumTermText.includes("NEAR_MEDIUM_DETAIL"));
    assert.ok(
      injection.mediumTermText.includes("MID_MEDIUM_DETAIL"),
      "N=10 block count must recover mid-horizon detail at T300"
    );
    assert.equal(injection.text.includes("NEAR_MEDIUM_DETAIL"), false);
    assert.equal(
      measureMediumGlobalLiteralDuplicateChars(injection.mediumTermText, injection.text),
      0
    );
  });
});

describe("MANUAL GLOBAL INTERACTION", () => {
  it("manual_global — medium OFF; does not reintroduce ledger ORIGINAL_DETAIL", async () => {
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 1,
      summary: padBody("ORIGINAL_DETAIL"),
      summaryKind: "main_canon",
    });
    __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));
    await updateLorebookForChat(
      CHAT,
      USER,
      CHAR,
      "USER_EDITED_GLOBAL removed ledger fact",
      "free",
      MEMORY_CAPACITY_FIXED
    );
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary,
    });
    assert.equal(resolved.projectionKind, "manual_global");

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.equal(injection.mediumTermText, "");
    assert.match(injection.text, /USER_EDITED_GLOBAL removed ledger fact/);
    assert.equal(/\bORIGINAL_DETAIL\b/.test(injection.text), false);
    assert.equal(injection.mediumTermText.includes("ORIGINAL_DETAIL"), false);
    assert.ok(listMemoryRecordsForChat(CHAT).some((r) => r.summary.includes("ORIGINAL_DETAIL")));
  });
});

describe("MEDIUM READER", () => {
  it("uses canonical record filters and chronological block format", () => {
    insertBlocks(14);
    const cutoff = rawOwnedTurnStart(62);
    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 5,
      excludeTurnStartGte: cutoff,
    });
    assert.equal(medium.blockCount, 5);
    assert.match(medium.text, /\[최근 기억 · T46–50\]/);
    assert.match(medium.text, /BLOCK_46/);
    assert.match(medium.text, /BLOCK_56/);
    assert.doesNotMatch(medium.text, /BLOCK_61/);
    for (const range of medium.turnRanges) {
      assert.ok(range.turnStart < cutoff);
    }
  });

  it("excludes inactive, closed branch, and noncanon-only rows", () => {
    insertBlocks(4);
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 21,
      turnEnd: 25,
      assistantMessageId: 21,
      summary: padBody("INACTIVE_ROW"),
      summaryKind: "main_canon",
    });
    markMemoryRecordInactive(CHAT, listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 21)!.id);

    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 26,
      turnEnd: 30,
      assistantMessageId: 22,
      summary: padBody("NONCANON_ROW"),
      summaryKind: "noncanon",
    });

    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 31,
      turnEnd: 35,
      assistantMessageId: 23,
      summary: padBody("CLOSED_BRANCH"),
      summaryKind: "branch_canon",
      branchStatus: "closed",
      branchId: "branch-x",
    });

    const eligible = listMediumTermEligibleRecords(CHAT, { excludeTurnStartGte: 100 });
    assert.equal(eligible.some((r) => r.summary.includes("INACTIVE_ROW")), false);
    assert.equal(eligible.some((r) => r.summary.includes("NONCANON_ROW")), false);
    assert.equal(eligible.some((r) => r.summary.includes("CLOSED_BRANCH")), false);
  });

  it("buildMediumTermMemoryBlockForProjection respects activation owner", () => {
    insertBlocks(8);
    const exact = buildMediumTermMemoryBlockForProjection({
      chatId: CHAT,
      blockCount: 5,
      projectionKind: "exact",
    });
    assert.equal(exact.text, "");
    const compact = buildMediumTermMemoryBlockForProjection({
      chatId: CHAT,
      blockCount: 5,
      projectionKind: "global_compact",
    });
    assert.ok(compact.text.includes("[최근 기억 · T"));
  });
});

describe("RAW MEDIUM PARTIAL OVERLAP", () => {
  it("INTENTIONAL_BOUNDED — one block may straddle RAW seal with turnStart < cutoff", () => {
    insertBlocks(20);
    const currentTurn = 62;
    const cutoff = rawOwnedTurnStart(currentTurn);
    assert.equal(cutoff, 59);
    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 10,
      excludeTurnStartGte: cutoff,
    });
    const overlapping = medium.turnRanges.filter(
      (range) => range.turnStart < cutoff && range.turnEnd >= cutoff
    );
    assert.equal(overlapping.length, 1);
    assert.equal(overlapping[0]!.turnStart, 56);
    assert.equal(overlapping[0]!.turnEnd, 60);
    assert.ok(medium.text.includes("BLOCK_56"));
    assert.equal(medium.text.includes("BLOCK_61"), false);
  });
});

describe("MEDIUM PROMPT INJECTION", () => {
  it("global_compact injects medium-term section in Main RP context assembly", async () => {
    insertMovingHorizonFixture(300);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    __setCompactCurrentMemoryTestOverride(async (_input, maxChars) =>
      "OLD_MAJOR_EVENT → RECENT_MAJOR_EVENT compact fold".slice(0, maxChars)
    );
    const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: compacted, membership_tier: "free" });

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
      provider: "openrouter",
      excludeSummaryTurnStartGte: rawOwnedTurnStart(300),
    });
    assert.ok(injection.mediumTermText.includes("[최근 기억 · T"));

    const built = buildContext({
      charName: "MediumChar",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "hi" }],
      currentUserMessage: "next",
      nsfw: false,
      provider: "openrouter",
      longTermMemory: injection.text,
      mediumTermMemoryBlock: injection.mediumTermText,
    });
    const ids = built.meta.trackedSections?.map((section) => section.id) ?? [];
    assert.ok(ids.includes("medium-term-memory"));
    assert.match(built.systemPrompt, /\[최근 기억 · T/);
  });

  it("DeepSeek — medium routes through existing LTM XML group", () => {
    const built = buildContext({
      charName: "MediumChar",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "hi" }],
      currentUserMessage: "next",
      nsfw: false,
      provider: "openrouter",
      modelId: "deepseek/deepseek-v4-pro",
      longTermMemory: "GLOBAL_COMPACT_STUB",
      mediumTermMemoryBlock: "[최근 기억 · T276–280]\nNEAR_MEDIUM_DETAIL body",
    });
    assert.match(built.systemPrompt, /<LONG_TERM_MEMORY>/);
    assert.match(built.systemPrompt, /NEAR_MEDIUM_DETAIL/);
    assert.match(built.systemPrompt, /GLOBAL_COMPACT_STUB/);
  });
});

describe("MEDIUM LIFECYCLE PARITY", () => {
  it("record edit/delete and branch mutations refresh eligible medium source", () => {
    insertBlocks(6);
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 31,
      turnEnd: 35,
      assistantMessageId: 31,
      summary: padBody("BRANCH_SOURCE"),
      summaryKind: "noncanon",
    });
    const noncanon = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 31)!;
    promoteRecordsToBranchCanon({
      chatId: CHAT,
      recordIds: [noncanon.id],
      branchId: "branch-y",
      promotedBy: "test",
    });
    closeActiveBranchCanon(CHAT);
    reopenClosedBranchCanon({ chatId: CHAT, branchId: "branch-y", source: "test" });

    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 1)!;
    updateMemoryRecordById(CHAT, row.id, padBody("EDITED_BLOCK_1"));

    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 10,
      excludeTurnStartGte: 100,
    });
    assert.ok(medium.text.includes("EDITED_BLOCK_1"));
    assert.ok(medium.text.includes("BRANCH_SOURCE"));
  });
});

describe("MEDIUM GLOBAL OVERLAP", () => {
  it("global_compact — literal duplicate chars are zero against compact Global", () => {
    insertBlocks(30);
    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 5,
      excludeTurnStartGte: rawOwnedTurnStart(160),
    });
    const globalCompact = "OLD_MAJOR → MID_MAJOR → RECENT_MAJOR whole-history fold";
    assert.equal(measureMediumGlobalLiteralDuplicateChars(medium.text, globalCompact), 0);
  });
});
