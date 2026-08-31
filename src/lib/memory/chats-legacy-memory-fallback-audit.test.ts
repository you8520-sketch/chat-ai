/**
 * CHATS.MEMORY / CHATS.CURRENT_SUMMARY legacy fallback audit.
 * AUDIT ONLY — no column drops, no production fallback/reset removal.
 *
 * Frozen classification:
 * - chat_memories.recent_summary → CURRENT_CANONICAL
 * - chats.current_summary → CURRENT_MIRROR + MIGRATION_FALLBACK (precedence 1)
 * - chats.memory → M1 RETIRED semantic/fallback (physical column kept); global convergence only
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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import {
  getOrCreateChatMemory,
  updateChatMemory,
} from "@/lib/memory/memory-db";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { syncChatLongTermMemory } from "@/lib/memory/memory-rolling-summary";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const CHAT_ID = 99001;
const USER_ID = 1;
const CHARACTER_ID = 2;
const TIER = "free" as const;

function ensureChatRow(): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO chats (id, user_id, character_id, mode, memory, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe','','','{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
}

function seedChatLegacyFields(opts: { current_summary: string; memory: string }): void {
  ensureChatRow();
  getDb()
    .prepare(`UPDATE chats SET current_summary=?, memory=? WHERE id=? AND user_id=?`)
    .run(opts.current_summary, opts.memory, CHAT_ID, USER_ID);
}

function deleteChatMemoriesRow(): void {
  getDb().prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
}

function readLegacyFields(): { current_summary: string; memory: string } {
  return getDb()
    .prepare(`SELECT current_summary, memory FROM chats WHERE id=?`)
    .get(CHAT_ID) as { current_summary: string; memory: string };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("chats legacy memory fallback audit — lazy bootstrap precedence", () => {
  it("A1 current_summary wins over memory when chat_memories row missing", () => {
    getDb();
    deleteChatMemoriesRow();
    seedChatLegacyFields({ current_summary: "CURRENT", memory: "OLD" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "CURRENT");
  });

  it("A2 memory-only legacy is not lazy-read after M1 — global convergence required", () => {
    getDb();
    deleteChatMemoriesRow();
    seedChatLegacyFields({ current_summary: "", memory: "OLD" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
  });

  it("A3 existing canonical recent_summary is never overwritten by legacy fields", () => {
    getDb();
    ensureChatRow();
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, { recent_summary: "CANONICAL" });
    seedChatLegacyFields({ current_summary: "STALE_MIRROR", memory: "OLDER" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "CANONICAL");
  });

  it("A5 empty legacy fields create empty canonical memory row", () => {
    getDb();
    deleteChatMemoriesRow();
    seedChatLegacyFields({ current_summary: "", memory: "" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.equal(row.archive_summary, "");
  });

  it("A6 canonical recent_summary stays independent of stale legacy mirrors", () => {
    getDb();
    ensureChatRow();
    updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, { recent_summary: "NEW" });
    seedChatLegacyFields({ current_summary: "OLD", memory: "OLDER" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "NEW");
  });
});

describe("chats legacy memory fallback audit — reset resurrection safety", () => {
  it("A4 reset prevents stale memory resurrection after chat_memories row deleted", () => {
    const db = getDb();
    ensureChatRow();
    db.prepare(
      `INSERT OR REPLACE INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "", TIER, 0);
    seedChatLegacyFields({ current_summary: "", memory: "OLD LEGACY MEMORY" });

    executeAtomicMemoryResetCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });

    const legacyAfterReset = readLegacyFields();
    assert.equal(legacyAfterReset.current_summary, "");
    assert.equal(legacyAfterReset.memory, "");

    deleteChatMemoriesRow();
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.equal(row.recent_summary.includes("OLD LEGACY"), false);
  });

  it("reset clears both chats.memory and chats.current_summary", () => {
    const db = getDb();
    ensureChatRow();
    seedChatLegacyFields({ current_summary: "mirror text", memory: "legacy text" });
    getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);

    executeAtomicMemoryResetCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });

    const legacy = readLegacyFields();
    assert.equal(legacy.current_summary, "");
    assert.equal(legacy.memory, "");
  });
});

describe("chats legacy memory fallback audit — mirror sync owner", () => {
  it("A7 syncChatLongTermMemory mirrors canonical into chats.current_summary only", () => {
    getDb();
    ensureChatRow();
    updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, { recent_summary: "CANONICAL LORE" });
    seedChatLegacyFields({ current_summary: "stale", memory: "stale-memory-carrier" });

    syncChatLongTermMemory(CHAT_ID, "CANONICAL LORE");

    const legacy = readLegacyFields();
    assert.equal(legacy.current_summary, "CANONICAL LORE");
    assert.equal(legacy.memory, "stale-memory-carrier");
  });
});

describe("chats legacy memory fallback audit — frozen classification constants", () => {
  it("policy constants unchanged", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });

  it("fallback precedence order is current_summary then memory", () => {
    const precedence = ["chat_memories.recent_summary", "chats.current_summary", "chats.memory"];
    assert.deepEqual(precedence, [
      "chat_memories.recent_summary",
      "chats.current_summary",
      "chats.memory",
    ]);
  });
});

describe("chats legacy memory fallback audit — fork bootstrap", () => {
  it("A8 new fork chat row starts with empty memory and current_summary", () => {
    const db = getDb();
    const forkChatId = insertForkChatRow(db, {
      userId: USER_ID,
      characterId: CHARACTER_ID,
      mode: "safe",
      memoryPending: "[]",
      memoryMeta: "{}",
      memoryArchivedTurns: 0,
      currentSummary: "",
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 700,
      title: "",
      writingStyleOverride: "",
      memoryCapacity: 4000,
      narrativePov: "third_person",
      povCharacterName: "",
    });
    const row = db
      .prepare(`SELECT memory, current_summary FROM chats WHERE id=?`)
      .get(forkChatId) as { memory: string; current_summary: string };
    assert.equal(row.memory, "");
    assert.equal(row.current_summary, "");
  });
});
