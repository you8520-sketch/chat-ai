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
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  buildMediumTermMemoryBlock,
  listMediumTermEligibleRecords,
  measureMediumGlobalLiteralDuplicateChars,
  rawOwnedTurnStart,
} from "./memory-medium-term";
import { getOrCreateChatMemory } from "./memory-db";
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

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  seedChat();
  process.env.MEMORY_FEATURE_ENABLED = "1";
});

afterEach(cleanup);

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
    // Partial overlap with RAW is intentional — 56–60 block stays when turnStart < cutoff.
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

  it("respects RAW overlap cutoff at seal boundary", () => {
    insertBlocks(20);
    const currentTurn = 62;
    const cutoff = rawOwnedTurnStart(currentTurn);
    assert.equal(cutoff, 59);
    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 10,
      excludeTurnStartGte: cutoff,
    });
    assert.ok(medium.turnRanges.every((r) => r.turnStart < cutoff));
    assert.ok(medium.text.includes("BLOCK_56"), "partial-overlap block 56–60 remains");
    assert.equal(medium.text.includes("BLOCK_61"), false, "blocks starting at RAW turn are excluded");
  });
});

describe("MEDIUM PROMPT INJECTION", () => {
  it("injects medium-term section in Main RP context assembly", async () => {
    insertBlocks(8);
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 10_000,
      userMessage: "continue",
      provider: "openrouter",
      excludeSummaryTurnStartGte: rawOwnedTurnStart(42),
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
  it("Design A — literal duplicate chars are bounded when Global is compact", () => {
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
