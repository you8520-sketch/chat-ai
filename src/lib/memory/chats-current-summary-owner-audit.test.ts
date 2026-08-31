/**
 * CHATS.CURRENT_SUMMARY canonical-owner / mirror necessity audit.
 * AUDIT ONLY — no column drops, no runtime retirement, no production behavior change.
 *
 * Post V7 (chats.memory physically absent). Verdict target: classification evidence only.
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
import { getDb } from "@/lib/db";
import { insertForkChatRow } from "@/lib/chatForkCreate";
import { buildMemoryContext } from "@/lib/memory/memory-injector";
import {
  getOrCreateChatMemory,
  updateChatMemory,
} from "@/lib/memory/memory-db";
import { executeAtomicMemoryResetCore } from "@/lib/memory/memory-source-boundary";
import { syncChatLongTermMemory } from "@/lib/memory/memory-rolling-summary";
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
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, current_summary, memory_meta, memory_pending, memory_archived_turns)
     VALUES (?,?,?,'safe',?,'{}','[]',0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, currentSummary);
}

function seedCanonical(recentSummary: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(CHAT_ID, USER_ID, CHARACTER_ID, recentSummary, "", TIER, recentSummary.length);
}

function readCurrentSummary(): string {
  return (
    getDb()
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(CHAT_ID) as { current_summary: string }
  ).current_summary;
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

describe("chats.current_summary owner audit — deterministic behavior", () => {
  it("CS-A1 canonical row wins over current_summary on read", () => {
    seedChat("OLD");
    seedCanonical("NEW");
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "NEW");
  });

  it("CS-A2 missing canonical + current_summary nonempty → lazy bootstrap", () => {
    seedChat("LAZY SOURCE");
    assert.equal(readRecentSummary(), "");
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "LAZY SOURCE");
    assert.equal(readRecentSummary(), "LAZY SOURCE");
  });

  it("CS-A3 reset clears current_summary and prevents stale resurrection after canonical delete", () => {
    seedChat("OLD");
    seedCanonical("NEW");
    executeAtomicMemoryResetCore(getDb(), {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHARACTER_ID,
      tier: TIER,
    });
    assert.equal(readRecentSummary(), "");
    assert.equal(readCurrentSummary(), "");

    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "");
    assert.notEqual(row.recent_summary, "OLD");
  });

  it("CS-A4 syncChatLongTermMemory mirrors canonical into current_summary", () => {
    seedChat("stale mirror");
    seedCanonical("canonical body");
    syncChatLongTermMemory(CHAT_ID, "canonical body");
    assert.equal(readCurrentSummary(), "canonical body");
  });

  it("CS-A6 fork insert starts with empty current_summary", () => {
    cleanup();
    const forkId = insertForkChatRow(getDb(), {
      userId: USER_ID,
      characterId: CHARACTER_ID,
      mode: "safe",
      memoryMeta: "{}",
      memoryPending: "[]",
      memoryArchivedTurns: 0,
      currentSummary: "",
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
    const row = getDb()
      .prepare(`SELECT current_summary FROM chats WHERE id=?`)
      .get(forkId) as { current_summary: string };
    assert.equal(row.current_summary, "");
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

  it("CS-A8 canonical functional when current_summary empty", () => {
    seedChat("");
    seedCanonical("CANONICAL ONLY");
    const memory = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(memory.recent_summary, "CANONICAL ONLY");
    const injection = buildMemoryContext({
      memory,
      userMessage: "test",
      memoryCapacity: MEMORY_CAPACITY,
    });
    assert.ok(injection.text.includes("CANONICAL ONLY"));
  });

  it("CS-A11 stale current_summary can resurrect if canonical row deleted without reset", () => {
    seedChat("OLD RESURRECT SOURCE");
    seedCanonical("NEW");
    getDb().prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
    const row = getOrCreateChatMemory(CHAT_ID, USER_ID, CHARACTER_ID, TIER);
    assert.equal(row.recent_summary, "OLD RESURRECT SOURCE");
  });
});

describe("chats.current_summary owner audit — mirror parity gaps", () => {
  it("CS-A4b manual updateLorebookForChat writes canonical but not current_summary mirror", async () => {
    seedChat("prior mirror");
    seedCanonical("prior canonical");
    await updateLorebookForChat(
      CHAT_ID,
      USER_ID,
      CHARACTER_ID,
      "manual edit body",
      TIER,
      MEMORY_CAPACITY
    );
    assert.equal(readRecentSummary(), "manual edit body");
    assert.equal(readCurrentSummary(), "prior mirror");
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

  it("INV-2 memory-injector reads recent_summary only — not current_summary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/memory/memory-injector.ts"),
      "utf8"
    );
    assert.ok(!src.includes("current_summary"));
  });

  it("INV-3 memory-manager prompt path uses getOrCreateChatMemory / recent_summary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/memory/memory-manager.ts"),
      "utf8"
    );
    assert.ok(src.includes("getOrCreateChatMemory"));
    assert.ok(src.includes("recent_summary"));
    assert.ok(!/SELECT[\s\S]*current_summary[\s\S]*FROM chats/.test(src));
  });

  it("INV-4 production mirror writers are confined to known locations", () => {
    const root = join(process.cwd(), "src");
    const files = listProductionTsFiles(root);
    const mirrorWriterHits: string[] = [];
    for (const file of files) {
      const rel = file.replace(process.cwd() + "/", "");
      const src = readFileSync(file, "utf8");
      if (/UPDATE\s+chats\s+SET[\s\S]*?current_summary\s*=/.test(src)) {
        mirrorWriterHits.push(rel);
      }
    }
    mirrorWriterHits.sort();
    assert.deepEqual(mirrorWriterHits, [
      "src/lib/memory/chats-memory-convergence.ts",
      "src/lib/memory/memory-db.ts",
      "src/lib/memory/memory-fork-snapshot.ts",
      "src/lib/memory/memory-rolling-summary.ts",
      "src/lib/memory/memory-source-boundary.ts",
      "src/lib/memory/memory-summary-migration.ts",
      "src/lib/memory/memory-summary-persist.ts",
      "src/lib/memory/memory-variant-switch-reconcile.ts",
    ]);
  });

  it("INV-5 /api/chat/memory GET does not SELECT current_summary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/chat/memory/route.ts"),
      "utf8"
    );
    assert.ok(!/SELECT[\s\S]*current_summary/.test(src));
    assert.ok(src.includes("getMemorySnapshot"));
  });
});
