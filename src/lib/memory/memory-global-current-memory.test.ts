/**
 * Global Current Memory correction-pass regressions — zero provider calls in tests.
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
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { emergencyFallbackTrimLorebookSync, isMechanicalEmergencyTrim } from "./memory-global-projection";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import {
  __setCompactCurrentMemoryTestOverride,
  compactCurrentMemory,
} from "./memory-rolling-summary";
import { buildMemoryContextForChat, updateLorebookForChat } from "./memory-manager";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
  updateMemoryRecordById,
} from "./memory-turn-summary";
import { invalidateDerivedMemoryGeneration } from "./memory-source-boundary";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import { formatMemoryBlock } from "./memory-turn-summary";

const CHAT = 994001;
const USER = 994002;
const CHAR = 994003;

const OLD_MAJOR = "OLD_MAJOR_EVENT";
const MID_MAJOR = "MID_MAJOR_EVENT";
const RECENT_MAJOR = "RECENT_MAJOR_EVENT";

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
}

function seedChat(): void {
  const db = getDb();
  cleanup();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `global-${USER}@test.local`,
    "global-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "GlobalChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function padBody(marker: string, chars = 480): string {
  let body = `${marker} → major story beat → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function insertGlobalCoverageFixture(): void {
  const db = getDb();
  const markers = [
    { turnStart: 16, turnEnd: 20, marker: OLD_MAJOR },
    { turnStart: 146, turnEnd: 150, marker: MID_MAJOR },
    { turnStart: 286, turnEnd: 290, marker: RECENT_MAJOR },
  ];
  for (let i = 0; i < 60; i++) {
    const turnStart = i * ROLLING_SUMMARY_INTERVAL + 1;
    const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
    const tagged = markers.find((m) => m.turnStart === turnStart);
    const marker = tagged?.marker ?? `FILLER_${i}`;
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
       VALUES (?,?,?,?,?)`
    ).run(CHAT, turnStart, turnEnd, padBody(marker), "main_canon");
  }
}

function extractPromptRecent(injectionText: string): string {
  const match = injectionText.match(/\[현재기억\][\s\S]*?\n\n([\s\S]*)$/);
  return match?.[1]?.trim() ?? injectionText;
}

async function commitGlobalCompact(rebuilt: string): Promise<string> {
  __setCompactCurrentMemoryTestOverride(async (input, maxChars) => {
    assert.ok(input.includes(OLD_MAJOR));
    assert.ok(input.includes(MID_MAJOR));
    assert.ok(input.includes(RECENT_MAJOR));
    return `${OLD_MAJOR} → ${MID_MAJOR} → ${RECENT_MAJOR} → global fold`
      .padEnd(Math.min(maxChars, 9000), ".")
      .slice(0, maxChars);
  });
  const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
  updateChatMemory(CHAT, USER, CHAR, { recent_summary: compacted, membership_tier: "free" });
  return compacted;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("GLOBAL COVERAGE REGRESSION", () => {
  beforeEach(seedChat);

  it("reproduces recent-only failure mode on mechanical trim without compact projection", () => {
    insertGlobalCoverageFixture();
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED);
    const mechanical = emergencyFallbackTrimLorebookSync(rebuilt, MEMORY_CAPACITY_FIXED);
    assert.ok(mechanical.includes(RECENT_MAJOR));
    assert.equal(mechanical.includes(OLD_MAJOR), false);
    assert.ok(isMechanicalEmergencyTrim(rebuilt, mechanical, MEMORY_CAPACITY_FIXED));
  });

  it("whole-history compact projection retains OLD/MID/RECENT in Main RP prompt", async () => {
    insertGlobalCoverageFixture();
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const compacted = await commitGlobalCompact(rebuilt);

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: compacted,
    });
    assert.equal(resolved.projectionKind, "global_compact");
    assert.equal(resolved.source, "chat_memories_recent_summary");
    assert.equal(resolved.text, compacted);

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    const prompt = extractPromptRecent(injection.text);
    assert.ok(prompt.includes(OLD_MAJOR));
    assert.ok(prompt.includes(MID_MAJOR));
    assert.ok(prompt.includes(RECENT_MAJOR));
    assert.equal(prompt, compacted.trim());
  });
});

describe("GLOBAL OWNER + FRESHNESS", () => {
  beforeEach(() => {
    seedChat();
    __setCompactCurrentMemoryTestOverride(null);
  });

  after(() => __setCompactCurrentMemoryTestOverride(null));

  it("write/read parity — stored compact equals prompt projection", async () => {
    insertGlobalCoverageFixture();
    const compacted = await commitGlobalCompact(rebuildLorebookFromRecords(CHAT));
    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.trim(), compacted.trim());
    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "x",
    });
    assert.equal(extractPromptRecent(injection.text), compacted.trim());
  });

  it("record edit invalidates stale compact projection", async () => {
    insertGlobalCoverageFixture();
    await commitGlobalCompact(rebuildLorebookFromRecords(CHAT));
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 16)!;
    updateMemoryRecordById(
      CHAT,
      row.id,
      `${OLD_MAJOR}_EDITED body with enough length to pass validation checks here and padding.`
    );
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary,
    });
    assert.equal(resolved.projectionKind, "failure_fallback");
    assert.equal(resolved.needsBackgroundCompact, true);
  });

  it("delete/inactivate invalidates compact projection freshness", async () => {
    insertGlobalCoverageFixture();
    await commitGlobalCompact(rebuildLorebookFromRecords(CHAT));
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 286)!;
    markMemoryRecordInactive(CHAT, row.id);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary,
    });
    assert.notEqual(resolved.projectionKind, "global_compact");
  });

  it("reset epoch bump alone does not serve stale compact when records unchanged", async () => {
    insertGlobalCoverageFixture();
    const compacted = await commitGlobalCompact(rebuildLorebookFromRecords(CHAT));
    invalidateDerivedMemoryGeneration(CHAT);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: compacted,
    });
    assert.equal(resolved.projectionKind, "global_compact");
  });

  it("below 10K uses exact rebuild fidelity", () => {
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
         VALUES (?,?,?,?,?)`
      )
      .run(
        CHAT,
        1,
        5,
        "SMALL_CHAT_MARKER body with enough length to pass validation checks here and padding.",
        "main_canon"
      );
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "exact");
    assert.match(resolved.text, /SMALL_CHAT_MARKER/);
  });

  it("arrow-less overflow never returns empty (failure fallback only)", () => {
    const blob = Array.from({ length: 40 }, (_, i) =>
      `[${i * 5 + 1}~${i * 5 + 5}턴] ${"화살표없는요약 ".repeat(40)}${i}`
    ).join("\n\n");
    const trimmed = trimLorebookToBudgetSync(blob, MEMORY_CAPACITY_FIXED);
    assert.ok(trimmed.length > 0);
    assert.ok(trimmed.length <= MEMORY_CAPACITY_FIXED);
  });
});

describe("WHOLE-MEMORY EDIT PROVENANCE", () => {
  beforeEach(seedChat);

  it("free-form updateLorebook preserves canonical 5-turn ledger rows", async () => {
    const db = getDb();
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 101,
      summary: padBody("LEDGER_BLOCK_1"),
      summaryKind: "main_canon",
      userEdited: false,
      sourceStartUserMessageId: 1001,
      sourceEndUserMessageId: 1002,
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 6,
      turnEnd: 10,
      assistantMessageId: 102,
      summary: padBody("LEDGER_BLOCK_2"),
      summaryKind: "branch_canon",
      branchStatus: "active",
      branchId: "branch-a",
      userEdited: false,
      sourceStartUserMessageId: 2001,
      sourceEndUserMessageId: 2002,
    });

    const before = listMemoryRecordsForChat(CHAT);
    assert.equal(before.filter((r) => !r.inactive).length, 2);

    __setCompactCurrentMemoryTestOverride(async (input, max) => input.slice(0, max));
    await updateLorebookForChat(
      CHAT,
      USER,
      CHAR,
      "FREE_FORM_USER_GLOBAL_EDIT without turn headers",
      "free",
      MEMORY_CAPACITY_FIXED
    );

    const after = listMemoryRecordsForChat(CHAT);
    assert.equal(after.filter((r) => !r.inactive).length, 2);
    assert.equal(after.filter((r) => r.inactive).length, 0);
    const sourceRow = db
      .prepare(
        `SELECT source_start_user_message_id FROM chat_turn_summaries
         WHERE chat_id=? AND turn_number=1 AND COALESCE(inactive,0)=0`
      )
      .get(CHAT) as { source_start_user_message_id: number | null };
    assert.equal(sourceRow.source_start_user_message_id, 1001);
    assert.ok(after.some((r) => r.branchId === "branch-a"));

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.match(extractPromptRecent(injection.text), /FREE_FORM_USER_GLOBAL_EDIT/);
  });

  it("destructive ledger sync would collapse spans — documented anti-pattern", () => {
    const db = getDb();
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 101,
      summary: padBody("KEEP_ME"),
      summaryKind: "main_canon",
      sourceStartUserMessageId: 42,
      sourceEndUserMessageId: 43,
    });
    db.prepare(
      `UPDATE chat_turn_summaries SET inactive=1 WHERE chat_id=? AND COALESCE(inactive,0)=0`
    ).run(CHAT);
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 301,
      turnEnd: 305,
      assistantMessageId: null,
      summary: "collapsed free-form global with enough length to pass validation checks here.",
      summaryKind: "main_canon",
      userEdited: true,
    });
    const rows = listMemoryRecordsForChat(CHAT);
    assert.equal(rows.filter((r) => !r.inactive).length, 1);
    assert.equal(rows.filter((r) => r.inactive).length, 1);
    assert.equal(rows.find((r) => !r.inactive)?.turnStart, 301);
  });
});
