/**
 * #804 owner audit — updated post-C1 for historical evidence + regression gates.
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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { hasChatsCurrentSummaryColumn } from "@/lib/memory/chats-memory-column-compat";
import { getDb, convergeLegacyChatsMemoryIntoCanonical } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { buildMemoryContext } from "@/lib/memory/memory-injector";
import {
  getOrCreateChatMemory,
  updateChatMemory,
} from "@/lib/memory/memory-db";
import { updateLorebookForChat } from "@/lib/memory/memory-manager";
import { ROLLING_SUMMARY_INTERVAL, RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const CHAT_ID = 99101;
const USER_ID = 1;
const CHARACTER_ID = 2;
const TIER = "free" as const;
const MEMORY_CAPACITY = 10_000;

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
}

function seedChat(currentSummary: string): void {
  const db = getDb();
  cleanup();
  if (!hasChatsCurrentSummaryColumn(db)) {
    db.exec(`ALTER TABLE chats ADD COLUMN current_summary TEXT NOT NULL DEFAULT ''`);
  }
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe',?,'{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, currentSummary);
}

function seedCanonical(recentSummary: string): void {
  getDb().prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, recentSummary, "", TIER, recentSummary.length);
}

function readCurrentSummary(): string {
  const db = getDb();
  if (!hasChatsCurrentSummaryColumn(db)) return "";
  return (
    db.prepare(`SELECT current_summary FROM chats WHERE id=?`).get(CHAT_ID) as
      | { current_summary: string }
      | undefined
  )?.current_summary ?? "";
}

function readRecentSummary(): string {
  return (
    getDb()
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT_ID) as { recent_summary: string } | undefined
  )?.recent_summary ?? "";
}

function listProductionTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".next-dev") continue;
      listProductionTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

describe("chats.current_summary owner audit — policy constants", () => {
  it("ROLLING_SUMMARY_INTERVAL=5 and RAW_HISTORY_COMPLETE_EXCHANGES=4 unchanged", () => {
    assert.equal(ROLLING_SUMMARY_INTERVAL, 5);
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });
});

describe("chats.current_summary owner audit — post-C1 behavior", () => {
  it("CS-A2 global convergence restores current_summary-only orphan", () => {
    seedChat("LAZY SOURCE");
    convergeLegacyChatsMemoryIntoCanonical(getDb());
    assert.equal(readRecentSummary(), "LAZY SOURCE");
    assert.equal(readCurrentSummary(), "");
  });

  it("CS-A3 cleared canonical bootstrap does not resurrect stale current_summary", () => {
    seedChat("OLD");
    seedCanonical("NEW");
    updateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, {
      recent_summary: "",
      archive_summary: "",
      membership_tier: TIER,
    });
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.notEqual(row.recent_summary, "OLD");
  });

  it("CS-A6 fork insert uses physical DEFAULT empty current_summary", () => {
    cleanup();
    const forkId = insertForkChatRow(getDb(), {
      userId: USER_ID,
      characterId: CHARACTER_ID,
      mode: "safe",
      memoryMeta: "{}",
      memoryPending: "[]",
      memoryArchivedTurns: 0,
      geminiModel: "",
      userNote: "",
      selectedPersonaId: null,
      userImpersonation: 0,
      targetResponseChars: 3200,
      title: "",
      writingStyleOverride: "",
      memoryCapacity: 10_000,
      narrativePov: "third",
      povCharacterName: "",
    });
    assert.ok(forkId > 0);
    const db = getDb();
    if (hasChatsCurrentSummaryColumn(db)) {
      const row = db
        .prepare(`SELECT current_summary FROM chats WHERE id=?`)
        .get(forkId) as { current_summary: string };
      assert.equal(row.current_summary, "");
    }
  });

  it("CS-A7 prompt injection uses canonical recent_summary when current_summary stale", () => {
    seedChat("STALE MIRROR ONLY");
    seedCanonical("CANONICAL FOR PROMPT");
    const memory = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    const injection = buildMemoryContext({
      memory,
      userMessage: "test",
      memoryCapacity: MEMORY_CAPACITY,
    });
    assert.ok(injection.text.includes("CANONICAL FOR PROMPT"));
    assert.ok(!injection.text.includes("STALE MIRROR ONLY"));
  });

  it("CS-A11 stale current_summary cannot resurrect after canonical row deleted (C1)", () => {
    seedChat("OLD RESURRECT SOURCE");
    seedCanonical("NEW");
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.notEqual(row.recent_summary, "OLD RESURRECT SOURCE");
  });
});

describe("chats.current_summary owner audit — production reference inventory", () => {
  it("INV-1 resolveLongTermMemory has zero production callers (DEAD)", () => {
    const root = join(process.cwd(), "src");
    const files = listProductionTsFiles(root);
    const callers: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (/resolveLongTermMemory\s*\(/.test(src) && !file.endsWith("rollingSummary.ts")) {
        callers.push(file.replace(process.cwd() + "/", ""));
      }
    }
    assert.deepEqual(callers, []);
  });

  it("INV-4 runtime mirror writers removed; historical convergence clear only", () => {
    const root = join(process.cwd(), "src");
    const hits: string[] = [];
    for (const file of listProductionTsFiles(root)) {
      const rel = file.replace(process.cwd() + "/", "");
      const src = readFileSync(file, "utf8");
      if (/UPDATE\s+chats\s+SET[\s\S]*?current_summary\s*=/.test(src)) {
        if (rel === "src/lib/memory/chats-memory-convergence.ts") continue;
        hits.push(rel);
      }
    }
    assert.deepEqual(hits, []);
  });
});
