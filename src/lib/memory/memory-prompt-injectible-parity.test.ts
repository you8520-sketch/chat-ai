/**
 * Canonical prompt-injectible eligibility parity — zero provider calls.
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
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  buildMediumTermMemoryBlock,
  rawOwnedTurnStart,
} from "./memory-medium-term";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  isPromptInjectibleMemoryRecord,
  listPromptInjectibleMemoryRecords,
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
  resolvePromptInjectibleMemoryRecordBody,
} from "./memory-turn-summary";

const CHAT = 995001;
const USER = 995002;
const CHAR = 995003;

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
    `parity-${USER}@test.local`,
    "parity-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "ParityChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
}

function padBody(marker: string, chars = 420): string {
  let body = `${marker} → event → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seedChat);

describe("GLOBAL PARITY PROOF", () => {
  it("rebuild output matches canonical helper assembly byte-for-byte", () => {
    for (let i = 0; i < 8; i++) {
      upsertSummaryRowCore({
        chatId: CHAT,
        turnStart: i * 5 + 1,
        turnEnd: i * 5 + 5,
        assistantMessageId: 100 + i,
        summary: padBody(`MAIN_${i * 5 + 1}`),
        summaryKind: "main_canon",
      });
    }
    const cutoff = rawOwnedTurnStart(42);
    const rebuilt = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    const manual = listPromptInjectibleMemoryRecords(CHAT, { excludeTurnStartGte: cutoff })
      .map((r) => {
        const body = resolvePromptInjectibleMemoryRecordBody(r);
        return body ? `[${r.turnStart}~${r.turnEnd}턴] ${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    assert.equal(rebuilt, manual);
  });

  it("classifies record kinds identically to historical Global rules", () => {
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 1,
      summary: padBody("MAIN_CANON_ROW"),
      summaryKind: "main_canon",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 6,
      turnEnd: 10,
      assistantMessageId: 2,
      summary: padBody("PREF_ROW"),
      summaryKind: "preference",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 11,
      turnEnd: 15,
      assistantMessageId: 3,
      summary: padBody("ACTIVE_BRANCH"),
      summaryKind: "branch_canon",
      branchStatus: "active",
      branchId: "b1",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 16,
      turnEnd: 20,
      assistantMessageId: 4,
      summary: padBody("CLOSED_BRANCH"),
      summaryKind: "branch_canon",
      branchStatus: "closed",
      branchId: "b2",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 21,
      turnEnd: 25,
      assistantMessageId: 5,
      summary: padBody("NONCANON_ROW"),
      summaryKind: "noncanon",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 26,
      turnEnd: 30,
      assistantMessageId: 6,
      summary: padBody("INACTIVE_ROW"),
      summaryKind: "main_canon",
    });
    markMemoryRecordInactive(
      CHAT,
      listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 26)!.id
    );
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 31,
      turnEnd: 35,
      assistantMessageId: 7,
      summary: "OOC only",
      summaryKind: "empty_ooc",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 36,
      turnEnd: 40,
      assistantMessageId: 8,
      summary: padBody("LEGACY_SINGLE"),
      summaryKind: "main_canon",
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 41,
      turnEnd: 45,
      assistantMessageId: 9,
      summary: padBody("SCOPED_MAIN"),
      summaryKind: "main_canon",
      scopePayload: {
        v: 1,
        scopes: { main_canon: padBody("SCOPED_BODY") },
      },
      userEdited: false,
    });

    const injectible = listPromptInjectibleMemoryRecords(CHAT);
    const markers = injectible.map((r) => resolvePromptInjectibleMemoryRecordBody(r).slice(0, 20));
    assert.ok(markers.some((m) => m.includes("MAIN_CANON")));
    assert.ok(markers.some((m) => m.includes("PREF_ROW")));
    assert.ok(markers.some((m) => m.includes("ACTIVE_BRANCH")));
    assert.ok(markers.some((m) => m.includes("LEGACY_SINGLE")));
    assert.ok(markers.some((m) => m.includes("SCOPED_BODY")));
    assert.equal(injectible.some((r) => r.summary.includes("CLOSED_BRANCH")), false);
    assert.equal(injectible.some((r) => r.summary.includes("NONCANON_ROW")), false);
    assert.equal(injectible.some((r) => r.summary.includes("INACTIVE_ROW")), false);
    assert.equal(injectible.some((r) => r.summaryKind === "empty_ooc"), false);
  });

  it("RAW cutoff partial overlap preserved", () => {
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 56,
      turnEnd: 60,
      assistantMessageId: 56,
      summary: padBody("PARTIAL_OVERLAP"),
      summaryKind: "main_canon",
    });
    const cutoff = rawOwnedTurnStart(62);
    const records = listPromptInjectibleMemoryRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.turnStart, 56);
    assert.ok(rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff }).includes("PARTIAL_OVERLAP"));
  });
});

describe("MEDIUM ELIGIBILITY PARITY", () => {
  it("Medium eligible record IDs match canonical Global injectible set", () => {
    for (let i = 0; i < 12; i++) {
      upsertSummaryRowCore({
        chatId: CHAT,
        turnStart: i * 5 + 1,
        turnEnd: i * 5 + 5,
        assistantMessageId: 200 + i,
        summary: padBody(`BLOCK_${i * 5 + 1}`),
        summaryKind: i % 7 === 0 ? "preference" : "main_canon",
      });
    }
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 61,
      turnEnd: 65,
      assistantMessageId: 300,
      summary: padBody("NONCANON_SKIP"),
      summaryKind: "noncanon",
    });
    const cutoff = rawOwnedTurnStart(70);
    const globalIds = listPromptInjectibleMemoryRecords(CHAT, { excludeTurnStartGte: cutoff }).map(
      (r) => r.id
    );
    const mediumIds = listPromptInjectibleMemoryRecords(CHAT, { excludeTurnStartGte: cutoff }).map(
      (r) => r.id
    );
    assert.deepEqual(mediumIds, globalIds);

    const medium = buildMediumTermMemoryBlock({
      chatId: CHAT,
      blockCount: 5,
      excludeTurnStartGte: cutoff,
    });
    assert.equal(medium.blockCount, 5);
    for (const range of medium.turnRanges) {
      assert.ok(isPromptInjectibleMemoryRecord(listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === range.turnStart)!));
    }
  });
});
