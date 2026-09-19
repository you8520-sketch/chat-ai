/**
 * Global Current Memory owner bugfix regressions — zero provider calls.
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
import {
  OVERFLOW_AUDIT_MARKERS,
  buildOverflowSummaryFixture,
  detectOverflowMarkers,
  joinOverflowBlocks,
} from "./memory-architecture-audit";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import {
  resolveGlobalCurrentMemory,
  resolveLorebookFromRecordsSync,
} from "./memory-lorebook-resolve";
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
import { persistValidatedSummaryBatch } from "./memory-summary-persist";

const CHAT = 994001;
const USER = 994002;
const CHAR = 994003;

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

function insertOverflowFixture(): void {
  const blocks = buildOverflowSummaryFixture({ blockCount: 28 });
  const db = getDb();
  for (const block of blocks) {
    db.prepare(
      `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
       VALUES (?,?,?,?,?)`
    ).run(CHAT, block.turnStart, block.turnEnd, block.body, "main_canon");
  }
}

function extractPromptRecent(injectionText: string): string {
  const match = injectionText.match(/\[현재기억\][\s\S]*?\n\n([\s\S]*)$/);
  return match?.[1]?.trim() ?? injectionText;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("GLOBAL CURRENT MEMORY OWNER BUGFIX", () => {
  beforeEach(() => {
    seedChat();
    __setCompactCurrentMemoryTestOverride(null);
  });

  after(() => {
    __setCompactCurrentMemoryTestOverride(null);
    cleanup();
  });

  it("A: write/read owner unified — prompt uses chat_turn_summaries rebuild, not stale compact blob", async () => {
    insertOverflowFixture();
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED);

    __setCompactCurrentMemoryTestOverride(async (_input, maxChars) =>
      `${OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY} → stale compact`.padEnd(maxChars, "x").slice(0, maxChars)
    );
    const staleCompact = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: staleCompact, membership_tier: "free" });

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: staleCompact,
    });
    assert.equal(resolved.source, "chat_turn_summaries");
    assert.notEqual(resolved.text, staleCompact.trim());

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    const promptRecent = extractPromptRecent(injection.text);
    assert.ok(!promptRecent.includes(OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY));
    assert.ok(promptRecent.includes(OVERFLOW_AUDIT_MARKERS.RECENT));
  });

  it("B: overflow keeps RECENT and drops OLD (prefer-recent block trim)", () => {
    insertOverflowFixture();
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const trimmed = trimLorebookToBudgetSync(rebuilt, MEMORY_CAPACITY_FIXED);
    const markers = detectOverflowMarkers(trimmed);
    assert.ok(markers.recent, "RECENT_MARKER retained");
    assert.equal(markers.old, false, "OLD_MARKER dropped under prefer-recent overflow");
  });

  it("C: arrow-less >10K never yields empty Current Memory", () => {
    const blob = Array.from({ length: 40 }, (_, i) =>
      `[${i * 5 + 1}~${i * 5 + 5}턴] ${"화살표없는요약 ".repeat(40)}${i}`
    ).join("\n\n");
    assert.ok(blob.length > MEMORY_CAPACITY_FIXED);
    const trimmed = trimLorebookToBudgetSync(blob, MEMORY_CAPACITY_FIXED);
    assert.ok(trimmed.length > 0, "non-empty overflow trim");
    assert.ok(trimmed.length <= MEMORY_CAPACITY_FIXED);
  });

  it("D: user whole-Current-Memory edit appears in next Main RP prompt", async () => {
    insertOverflowFixture();
    const userMarker = "USER_WHOLE_EDIT_MARKER_42";
    const edited = `[1~5턴] ${userMarker} → edited whole memory body`;
    await updateLorebookForChat(CHAT, USER, CHAR, edited, "free", MEMORY_CAPACITY_FIXED);

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.match(extractPromptRecent(injection.text), new RegExp(userMarker));
  });

  it("E: regen invalidates derived projection via epoch — stale compact not read", async () => {
    insertOverflowFixture();
    invalidateDerivedMemoryGeneration(CHAT);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.source, "chat_turn_summaries");
    assert.ok(resolved.text.includes(OVERFLOW_AUDIT_MARKERS.RECENT));
  });

  it("F: record edit changes prompt projection from canonical records", async () => {
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
         VALUES (?,?,?,?,?)`
      )
      .run(
        CHAT,
        1,
        5,
        "ORIGINAL_MARKER body with enough length to pass validation checks here and additional narrative padding.",
        "main_canon"
      );

    const before = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED).text;
    assert.match(before, /ORIGINAL_MARKER/);

    const row = listMemoryRecordsForChat(CHAT)[0]!;
    const edited = updateMemoryRecordById(
      CHAT,
      row.id,
      "EDITED_MARKER body with enough length to pass validation checks here and additional narrative padding."
    );
    assert.ok(edited, "record edit must persist");

    const after = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED).text;
    assert.match(after, /EDITED_MARKER/);
    assert.doesNotMatch(after, /ORIGINAL_MARKER/);
  });

  it("G: record delete/inactivate removes content from prompt projection", () => {
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
         VALUES (?,?,?,?,?)`
      )
      .run(
        CHAT,
        1,
        5,
        "DELETE_ME_MARKER body with enough length to pass validation checks here.",
        "main_canon"
      );
    const row = listMemoryRecordsForChat(CHAT)[0]!;
    markMemoryRecordInactive(CHAT, row.id);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.text.trim(), "");
  });

  it("H: reset epoch bump preserves rebuild path as canonical owner", () => {
    insertOverflowFixture();
    invalidateDerivedMemoryGeneration(CHAT);
    const mem = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    assert.ok((mem.memory_epoch ?? 0) >= 1);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.source, "chat_turn_summaries");
  });

  it("I: new seal after overflow uses rebuild mirror without LLM compact write", async () => {
    insertOverflowFixture();
    let compactCalls = 0;
    __setCompactCurrentMemoryTestOverride(async (input) => {
      compactCalls += 1;
      return input.slice(0, MEMORY_CAPACITY_FIXED);
    });

    const persisted = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 141,
      turnEnd: 145,
      assistantMessageId: null,
      summary:
        "NEW_SEAL_MARKER body with enough length to pass validation checks here and additional narrative padding for seal.",
      summaryKind: "main_canon",
      playableTurnCount: 145,
    });
    assert.equal(persisted.ok, true);
    assert.equal(compactCalls, 0, "seal path must not invoke provider compact");

    const mem = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    assert.ok(!mem.recent_summary.includes(OVERFLOW_AUDIT_MARKERS.COMPRESSED_ONLY));
    assert.ok(resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED).text.includes("NEW_SEAL_MARKER"));
  });

  it("below 10K keeps full per-record fidelity without compaction", () => {
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries (chat_id, turn_number, turn_end, summary, summary_kind)
         VALUES (?,?,?,?,?)`
      )
      .run(
        CHAT,
        1,
        5,
        "SMALL_CHAT_MARKER body with enough length to pass validation checks here.",
        "main_canon"
      );
    const resolved = resolveLorebookFromRecordsSync(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.overBudget, false);
    assert.match(resolved.text, /SMALL_CHAT_MARKER/);
  });
});
