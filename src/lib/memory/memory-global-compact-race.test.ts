/**
 * Global compact race regressions — zero provider calls.
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
import { ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import { getOrCreateChatMemory } from "./memory-db";
import { buildGlobalSummarySourceFingerprintFromText } from "./memory-global-source-fingerprint";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { scheduleBackgroundLorebookMaintenance } from "./memory-manager";
import { __setCompactCurrentMemoryTestOverride } from "./memory-rolling-summary";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  promoteRecordsToBranchCanon,
  rebuildLorebookFromRecords,
  reopenClosedBranchCanon,
  updateMemoryRecordById,
} from "./memory-turn-summary";
import { invalidateDerivedMemoryGenerationCore } from "./memory-source-boundary";
import { buildMemoryContextForChat } from "./memory-manager";
import { upsertSummaryRowCore } from "./memory-summary-persist";

const CHAT = 995001;
const USER = 995002;
const CHAR = 995003;

const RACE_OLD = "RACE_OLD_VALUE";
const RACE_NEW = "RACE_NEW_VALUE";
const STALE_COMPACT = "STALE_COMPACT_FROM_OLD_SOURCE";
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
    `race-${USER}@test.local`,
    "race-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "RaceChar");
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

function insertOverflowRaceFixture(): void {
  const db = getDb();
  for (let i = 0; i < 60; i++) {
    const turnStart = i * ROLLING_SUMMARY_INTERVAL + 1;
    const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
    let marker = `FILLER_${i}`;
    if (turnStart === 16) marker = RACE_OLD;
    if (turnStart === 146) marker = MID_MAJOR;
    if (turnStart === 286) marker = RECENT_MAJOR;
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

function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitUntil timeout"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

async function runCompactDuringMutationRace(opts: {
  mutate: () => void;
  staleCompactText: string;
}): Promise<void> {
  let compactEntered = false;
  let releaseCompact!: () => void;
  const compactGate = new Promise<void>((resolve) => {
    releaseCompact = resolve;
  });

  __setCompactCurrentMemoryTestOverride(async (input, maxChars) => {
    compactEntered = true;
    assert.ok(input.includes(RACE_OLD));
    await compactGate;
    return opts.staleCompactText.slice(0, maxChars);
  });

  scheduleBackgroundLorebookMaintenance({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
  });

  await waitUntil(() => compactEntered);
  opts.mutate();
  releaseCompact();
  await new Promise((r) => setTimeout(r, 150));
}

/** Legacy timestamp-only freshness — documents false-positive risk. */
function isGlobalCompactFreshByTimestampOnly(
  chatId: number,
  rebuilt: string,
  stored: string,
  maxChars: number
): boolean {
  const normalizedStored = stored.trim();
  if (!normalizedStored || normalizedStored.length > maxChars) return false;
  const row = getDb()
    .prepare(
      `SELECT MAX(updated_at) AS max_updated FROM chat_turn_summaries
       WHERE chat_id=? AND COALESCE(inactive,0)=0`
    )
    .get(chatId) as { max_updated: string | null };
  const memory = getDb()
    .prepare(`SELECT updated_at FROM chat_memories WHERE chat_id=?`)
    .get(chatId) as { updated_at: string | null };
  const maxRecordUpdated = row?.max_updated ?? null;
  const memoryUpdated = memory?.updated_at ?? null;
  if (maxRecordUpdated && memoryUpdated && maxRecordUpdated > memoryUpdated) return false;
  return normalizedStored !== rebuilt.trim();
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  seedChat();
  process.env.MEMORY_FEATURE_ENABLED = "1";
});

afterEach(() => {
  __setCompactCurrentMemoryTestOverride(null);
  cleanup();
});

describe("RECORD-EDIT RACE", () => {
  it("rejects stale compact commit when source row edited during compact", async () => {
    insertOverflowRaceFixture();
    const rebuiltBefore = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuiltBefore.includes(RACE_OLD));
    assert.ok(rebuiltBefore.length > MEMORY_CAPACITY_FIXED);

    await runCompactDuringMutationRace({
      mutate: () => {
        const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 16)!;
        updateMemoryRecordById(CHAT, row.id, padBody(RACE_NEW));
      },
      staleCompactText: `${STALE_COMPACT} → ${RACE_OLD} → ${OLD_MAJOR} → ${MID_MAJOR} → ${RECENT_MAJOR}`,
    });

    const rebuiltAfter = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuiltAfter.includes(RACE_NEW));
    assert.equal(rebuiltAfter.includes(RACE_OLD), false);

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);
    assert.ok(rebuiltAfter.includes(RACE_NEW));

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: stored,
    });
    assert.notEqual(resolved.projectionKind, "global_compact");
    assert.equal(resolved.text.includes(STALE_COMPACT), false);

    const injection = await buildMemoryContextForChat({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      userMessage: "continue",
    });
    assert.equal(extractPromptRecent(injection.text).includes(STALE_COMPACT), false);
    assert.equal(extractPromptRecent(injection.text).includes(RACE_OLD), false);
  });
});

describe("DELETE RACE", () => {
  it("rejects stale compact when record inactivated during compact", async () => {
    insertOverflowRaceFixture();
    await runCompactDuringMutationRace({
      mutate: () => {
        const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 286)!;
        markMemoryRecordInactive(CHAT, row.id);
      },
      staleCompactText: `${STALE_COMPACT} → ${RACE_OLD} → ${RECENT_MAJOR}`,
    });

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);
    assert.equal(stored.includes(RECENT_MAJOR), false);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: stored,
    });
    assert.notEqual(resolved.projectionKind, "global_compact");
  });
});

describe("BRANCH RACE", () => {
  it("rejects stale compact when branch promoted during compact", async () => {
    insertOverflowRaceFixture();
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 301,
      turnEnd: 305,
      assistantMessageId: 301,
      summary: padBody("BRANCH_RACE_NONCANON"),
      summaryKind: "noncanon",
      userEdited: false,
    });
    const noncanon = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 301)!;

    await runCompactDuringMutationRace({
      mutate: () => {
        promoteRecordsToBranchCanon({
          chatId: CHAT,
          recordIds: [noncanon.id],
          branchId: "branch-race-a",
          promotedBy: "test",
        });
      },
      staleCompactText: `${STALE_COMPACT} → ${RACE_OLD} → BRANCH_RACE_NONCANON`,
    });

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);
    assert.ok(stored.includes("BRANCH_RACE_NONCANON"));
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: stored,
    });
    assert.notEqual(resolved.projectionKind, "global_compact");
  });

  it("rejects stale compact when branch reopened during compact", async () => {
    insertOverflowRaceFixture();
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 301,
      turnEnd: 305,
      assistantMessageId: 302,
      summary: padBody("BRANCH_REOPEN_RACE"),
      summaryKind: "branch_canon",
      branchStatus: "closed",
      branchId: "branch-race-b",
      userEdited: false,
    });
    const branchRow = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 301)!;

    await runCompactDuringMutationRace({
      mutate: () => {
        reopenClosedBranchCanon({
          chatId: CHAT,
          branchId: "branch-race-b",
          source: "test",
        });
      },
      staleCompactText: `${STALE_COMPACT} → ${RACE_OLD} → closed_branch_state`,
    });

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);
    assert.ok(listMemoryRecordsForChat(CHAT).some((r) => r.branchId === "branch-race-b" && r.branchStatus === "active"));
  });
});

describe("RESET RACE", () => {
  it("rejects stale compact when memory_epoch bumps during compact", async () => {
    insertOverflowRaceFixture();
    let compactEntered = false;
    let releaseCompact!: () => void;
    const compactGate = new Promise<void>((resolve) => {
      releaseCompact = resolve;
    });

    __setCompactCurrentMemoryTestOverride(async (input, maxChars) => {
      compactEntered = true;
      await compactGate;
      return `${STALE_COMPACT} → ${input.slice(0, 200)}`.slice(0, maxChars);
    });

    scheduleBackgroundLorebookMaintenance({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });

    await waitUntil(() => compactEntered);
    invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
    releaseCompact();
    await new Promise((r) => setTimeout(r, 150));

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);
  });
});

describe("TIMESTAMP FRESHNESS", () => {
  it("same-second timestamps can false-positive as fresh under legacy heuristic", () => {
    insertOverflowRaceFixture();
    const db = getDb();
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const staleCompact = `${STALE_COMPACT} → ${RACE_OLD} → ${MID_MAJOR} → ${RECENT_MAJOR}`.slice(
      0,
      MEMORY_CAPACITY_FIXED
    );

    db.prepare(`UPDATE chat_memories SET recent_summary=?, updated_at=datetime('now') WHERE chat_id=?`).run(
      staleCompact,
      CHAT
    );
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 16)!;
    db.prepare(
      `UPDATE chat_turn_summaries SET summary=?, updated_at=datetime('now') WHERE id=? AND chat_id=?`
    ).run(padBody(RACE_NEW), row.id, CHAT);
    db.prepare(
      `UPDATE chat_memories SET updated_at=(SELECT MAX(updated_at) FROM chat_turn_summaries WHERE chat_id=? AND COALESCE(inactive,0)=0) WHERE chat_id=?`
    ).run(CHAT, CHAT);

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    const rebuiltAfter = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuiltAfter.includes(RACE_NEW));

    assert.equal(
      isGlobalCompactFreshByTimestampOnly(CHAT, rebuiltAfter, stored, MEMORY_CAPACITY_FIXED),
      true,
      "timestamp-only heuristic false positive"
    );

    assert.equal(
      buildGlobalSummarySourceFingerprintFromText(rebuilt) ===
        buildGlobalSummarySourceFingerprintFromText(rebuiltAfter),
      false
    );
  });

  it("production record edit invalidates stale compact without timestamp reliance", () => {
    insertOverflowRaceFixture();
    const db = getDb();
    const staleCompact = `${STALE_COMPACT} → ${RACE_OLD} → ${MID_MAJOR} → ${RECENT_MAJOR}`.slice(
      0,
      MEMORY_CAPACITY_FIXED
    );
    db.prepare(`UPDATE chat_memories SET recent_summary=? WHERE chat_id=?`).run(staleCompact, CHAT);

    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 16)!;
    updateMemoryRecordById(CHAT, row.id, padBody(RACE_NEW));

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.equal(stored.includes(STALE_COMPACT), false);

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: stored,
    });
    assert.notEqual(resolved.projectionKind, "global_compact");
    assert.equal(resolved.text.includes(STALE_COMPACT), false);
  });
});

describe("HEALTHY COMPACT AFTER RACE FIX", () => {
  it("whole-history compact retains OLD/MID/RECENT when source stable", async () => {
    insertOverflowRaceFixture();
    let compactEntered = false;
    let releaseCompact!: () => void;
    const compactGate = new Promise<void>((resolve) => {
      releaseCompact = resolve;
    });

    __setCompactCurrentMemoryTestOverride(async (input, maxChars) => {
      compactEntered = true;
      assert.ok(input.includes(RACE_OLD));
      assert.ok(input.includes(MID_MAJOR));
      assert.ok(input.includes(RECENT_MAJOR));
      await compactGate;
      return `${OLD_MAJOR} → ${MID_MAJOR} → ${RECENT_MAJOR} → stable fold`
        .padEnd(Math.min(maxChars, 9000), ".")
        .slice(0, maxChars);
    });

    scheduleBackgroundLorebookMaintenance({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
    });

    await waitUntil(() => compactEntered);
    releaseCompact();
    await new Promise((r) => setTimeout(r, 150));

    const stored = getOrCreateChatMemory(CHAT, USER, CHAR, "free").recent_summary;
    assert.ok(stored.includes(OLD_MAJOR));
    assert.ok(stored.includes(MID_MAJOR));
    assert.ok(stored.includes(RECENT_MAJOR));

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: stored,
    });
    assert.equal(resolved.projectionKind, "global_compact");
    assert.equal(resolved.text, stored.trim());
  });
});
