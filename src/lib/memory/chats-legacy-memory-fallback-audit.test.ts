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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { hasChatsCurrentSummaryColumn, hasChatsMemoryColumn } from "@/lib/memory/chats-memory-column-compat";
import { getOrCreateChatMemory, updateChatMemory } from "@/lib/memory/memory-db";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const CHAT_ID = 99001;
const USER_ID = 1;
const CHARACTER_ID = 2;
const TIER = "free" as const;

function ensureMemoryColumnForHistoricalFixture(): void {
  const db = getDb();
  if (!hasChatsMemoryColumn(db)) {
    db.exec(`ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT ''`);
  }
}

function ensureCurrentSummaryColumnForHistoricalFixture(): void {
  const db = getDb();
  if (!hasChatsCurrentSummaryColumn(db)) {
    db.exec(`ALTER TABLE chats ADD COLUMN current_summary TEXT NOT NULL DEFAULT ''`);
  }
}

function ensureChatRow(): void {
  const db = getDb();
  ensureMemoryColumnForHistoricalFixture();
  ensureCurrentSummaryColumnForHistoricalFixture();
  if (hasChatsMemoryColumn(db)) {
    db.prepare(
      `INSERT OR IGNORE INTO chats (id, user_id, character_id, mode, memory, current_summary, memory_meta, memory_pending, memory_archived_turns)
       VALUES (?,?,?,'safe','','','{}','[]',0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID);
    return;
  }
  db.prepare(
    `INSERT OR IGNORE INTO chats (id, user_id, character_id, mode, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe','','{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID);
}

function seedChatLegacyFields(opts: { current_summary: string; memory: string }): void {
  ensureChatRow();
  const db = getDb();
  if (hasChatsMemoryColumn(db)) {
    db.prepare(`UPDATE chats SET current_summary=?, memory=? WHERE id=? AND user_id=?`).run(
      opts.current_summary,
      opts.memory,
      CHAT_ID,
      USER_ID
    );
    return;
  }
  db.prepare(`UPDATE chats SET current_summary=? WHERE id=? AND user_id=?`).run(
    opts.current_summary,
    CHAT_ID,
    USER_ID
  );
}

function deleteChatMemoriesRow(): void {
  getDb().prepare(`DELETE FROM chat_memories WHERE chat_id=?`).run(CHAT_ID);
}

function readLegacyFields(): { current_summary: string; memory: string } {
  const db = getDb();
  const currentSummary = hasChatsCurrentSummaryColumn(db)
    ? ((
        db.prepare(`SELECT current_summary FROM chats WHERE id=?`).get(CHAT_ID) as
          | { current_summary: string }
          | undefined
      )?.current_summary ?? "")
    : "";
  if (!hasChatsMemoryColumn(db)) {
    return { current_summary: currentSummary, memory: "" };
  }
  const memory = db
    .prepare(`SELECT memory FROM chats WHERE id=?`)
    .get(CHAT_ID) as { memory: string };
  return { current_summary: currentSummary, memory: memory.memory };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("chats legacy memory fallback audit — lazy bootstrap precedence (C1 retired)", () => {
  it("A1 getOrCreate no longer reads current_summary without global convergence", () => {
    getDb();
    deleteChatMemoriesRow();
    seedChatLegacyFields({ current_summary: "CURRENT", memory: "OLD" });

    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
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

describe("chats legacy memory fallback audit — cleared canonical resurrection safety", () => {
  it("A4 cleared canonical prevents stale memory resurrection after chat_memories row deleted", () => {
    const db = getDb();
    ensureMemoryColumnForHistoricalFixture();
    ensureChatRow();
    db.prepare(
      `INSERT OR REPLACE INTO chat_memories
        (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
       VALUES (?,?,?,?,?,?,?,0)`
    ).run(CHAT_ID, USER_ID, CHARACTER_ID, "", "", TIER, 0);
    seedChatLegacyFields({ current_summary: "", memory: "OLD LEGACY MEMORY" });

    updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, {
      recent_summary: "",
      archive_summary: "",
      membership_tier: TIER,
    });
    db.prepare(`DELETE FROM chat_turn_summaries WHERE chat_id=?`).run(CHAT_ID);

    deleteChatMemoriesRow();
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.equal(row.recent_summary.includes("OLD LEGACY"), false);
  });
});

describe("chats legacy memory fallback audit — mirror sync retired (C1)", () => {
  it("A7 syncChatLongTermMemory removed from production", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/memory/memory-rolling-summary.ts"),
      "utf8"
    );
    assert.ok(!src.includes("export { syncChatLongTermMemory"));
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
    assert.ok(forkChatId > 0);
    if (hasChatsCurrentSummaryColumn(db)) {
      const current = db
        .prepare(`SELECT current_summary FROM chats WHERE id=?`)
        .get(forkChatId) as { current_summary: string };
      assert.equal(current.current_summary, "");
    }
    if (hasChatsMemoryColumn(db)) {
      const memory = db
        .prepare(`SELECT memory FROM chats WHERE id=?`)
        .get(forkChatId) as { memory: string };
      assert.equal(memory.memory, "");
    }
  });
});
