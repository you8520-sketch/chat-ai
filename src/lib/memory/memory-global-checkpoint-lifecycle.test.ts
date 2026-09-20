/**
 * Global durable checkpoint + append-only compaction lifecycle — zero provider calls.
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
import { ROLLING_SUMMARY_INTERVAL, ROLLING_SUMMARY_TARGET_CHARS } from "./memory-constants";
import {
  buildPrefixFingerprintThroughTurn,
  readGlobalCheckpointSnapshot,
} from "./memory-global-checkpoint";
import { executeGlobalLorebookCompaction } from "./memory-global-compaction-execution";
import { getChatMemoryRow, getOrCreateChatMemory } from "./memory-db";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { getMemorySourceBoundary } from "./memory-source-boundary";
import { shouldInjectMediumTermMemory } from "./memory-medium-term";
import {
  __setCompactCurrentMemoryTestOverride,
  compactCurrentMemory,
} from "./memory-rolling-summary";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  markMemoryRecordInactive,
  rebuildLorebookFromRecords,
  updateMemoryRecordById,
} from "./memory-turn-summary";
import { updateLorebookForChat } from "./memory-manager";

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
    `checkpoint-${USER}@test.local`,
    "checkpoint-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "CheckpointChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function padBody(marker: string, chars = ROLLING_SUMMARY_TARGET_CHARS): string {
  let body = `${marker} → event → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

function insertBlocksThrough(endTurn: number): void {
  for (let start = 1; start + ROLLING_SUMMARY_INTERVAL - 1 <= endTurn; start += ROLLING_SUMMARY_INTERVAL) {
    const end = start + ROLLING_SUMMARY_INTERVAL - 1;
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: start,
      turnEnd: end,
      assistantMessageId: 2000 + start,
      summary: padBody(`BLOCK_T${start}`),
      summaryKind: "main_canon",
      userEdited: false,
    });
  }
}

async function runCompact(trigger: "post_seal" | "background" = "post_seal"): Promise<void> {
  const memory = getChatMemoryRow(CHAT)!;
  const checkpointBefore = readGlobalCheckpointSnapshot(memory);
  await executeGlobalLorebookCompaction({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    boundarySnapshot: getMemorySourceBoundary(CHAT),
    checkpointBeforePersist: checkpointBefore,
    playableTurnCount: memory.summarized_turn_count ?? undefined,
    trigger,
  });
}

function readCheckpoint() {
  const row = getChatMemoryRow(CHAT)!;
  return readGlobalCheckpointSnapshot(row);
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seedChat);

describe("CHECKPOINT LIFECYCLE A–F", () => {
  beforeEach(() => {
    __setCompactCurrentMemoryTestOverride(async (input, max) => {
      const marker = input.includes("BLOCK_T") ? "COMPACT" : "INCR";
      return `${marker}_${input.length}`.slice(0, max);
    });
  });

  after(() => {
    __setCompactCurrentMemoryTestOverride(null);
  });

  it("A→F full append / mutation / recovery lifecycle", async () => {
    insertBlocksThrough(300);
    assert.ok(rebuildLorebookFromRecords(CHAT).length > MEMORY_CAPACITY_FIXED);

    await runCompact();
    const cpA = readCheckpoint();
    assert.equal(cpA.projectionKind, "global_compact");
    assert.equal(cpA.coveredThroughTurn, 300);
    assert.ok(cpA.sourceFingerprint);
    assert.equal(
      cpA.sourceFingerprint,
      buildPrefixFingerprintThroughTurn(CHAT, 300)
    );

    insertBlocksThrough(305);
    const modeB = (
      await executeGlobalLorebookCompaction({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        boundarySnapshot: getMemorySourceBoundary(CHAT),
        checkpointBeforePersist: cpA,
        playableTurnCount: 305,
        trigger: "post_seal",
      })
    ).mode;
    assert.equal(modeB, "incremental_append");
    const cpB = readCheckpoint();
    assert.equal(cpB.coveredThroughTurn, 305);

    insertBlocksThrough(310);
    const modeC = (
      await executeGlobalLorebookCompaction({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        boundarySnapshot: getMemorySourceBoundary(CHAT),
        checkpointBeforePersist: cpB,
        playableTurnCount: 310,
        trigger: "post_seal",
      })
    ).mode;
    assert.equal(modeC, "incremental_append");

    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    updateMemoryRecordById(CHAT, row.id, padBody("EDITED_T41_45"));
    const cpAfterEdit = readCheckpoint();
    assert.equal(cpAfterEdit.projectionKind, null);
    assert.equal(cpAfterEdit.sourceFingerprint, null);

    insertBlocksThrough(315);
    const modeE = (
      await executeGlobalLorebookCompaction({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        boundarySnapshot: getMemorySourceBoundary(CHAT),
        checkpointBeforePersist: cpAfterEdit,
        playableTurnCount: 315,
        trigger: "post_seal",
      })
    ).mode;
    assert.equal(modeE, "full_rebuild");
    const cpE = readCheckpoint();
    assert.equal(cpE.coveredThroughTurn, 315);

    insertBlocksThrough(320);
    const modeF = (
      await executeGlobalLorebookCompaction({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        memoryCapacity: MEMORY_CAPACITY_FIXED,
        boundarySnapshot: getMemorySourceBoundary(CHAT),
        checkpointBeforePersist: cpE,
        playableTurnCount: 320,
        trigger: "post_seal",
      })
    ).mode;
    assert.equal(modeF, "incremental_append");
  });
});

describe("PREFIX FINGERPRINT", () => {
  it("append-only preserves prefix; edit invalidates", () => {
    insertBlocksThrough(300);
    const fp300 = buildPrefixFingerprintThroughTurn(CHAT, 300);
    insertBlocksThrough(305);
    assert.equal(buildPrefixFingerprintThroughTurn(CHAT, 300), fp300);
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    updateMemoryRecordById(CHAT, row.id, padBody("EDITED"));
    assert.notEqual(buildPrefixFingerprintThroughTurn(CHAT, 300), fp300);
  });
});

describe("MANUAL GLOBAL", () => {
  it("manual edit clears checkpoint and blocks incremental", async () => {
    insertBlocksThrough(300);
    __setCompactCurrentMemoryTestOverride(async (input, max) => `COMPACT_${input.length}`.slice(0, max));
    await runCompact();
    await updateLorebookForChat(CHAT, USER, CHAR, "USER_MANUAL_GLOBAL_TEXT", "free", MEMORY_CAPACITY_FIXED);
    const cp = readCheckpoint();
    assert.equal(cp.projectionKind, "manual_global");
    assert.equal(cp.sourceFingerprint, null);
    assert.equal(cp.coveredThroughTurn, null);
    insertBlocksThrough(305);
    const result = await executeGlobalLorebookCompaction({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist: cp,
      playableTurnCount: 305,
      trigger: "post_seal",
    });
    assert.notEqual(result.mode, "incremental_append");
    __setCompactCurrentMemoryTestOverride(null);
  });
});

describe("RESTART SAFETY", () => {
  it("reloads checkpoint eligibility from DB only", async () => {
    insertBlocksThrough(305);
    __setCompactCurrentMemoryTestOverride(async (input, max) => `COMPACT_${input.length}`.slice(0, max));
    await runCompact();
    const cp = readCheckpoint();
    const eligibility = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    assert.deepEqual(eligibility.sourceFingerprint, cp.sourceFingerprint);
    assert.equal(eligibility.coveredThroughTurn, 305);
    __setCompactCurrentMemoryTestOverride(null);
  });
});

describe("CONCURRENCY STALE REJECT", () => {
  it("rejects commit when source mutates during compact", async () => {
    insertBlocksThrough(300);
    __setCompactCurrentMemoryTestOverride(async (input, max) => {
      const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
      updateMemoryRecordById(CHAT, row.id, padBody("RACE_EDIT_DURING_COMPACT"));
      return `COMPACT_RACE`.slice(0, max);
    });
    const before = readCheckpoint();
    const result = await executeGlobalLorebookCompaction({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist: before,
      playableTurnCount: 300,
      trigger: "post_seal",
    });
    assert.equal(result.committed, false);
    __setCompactCurrentMemoryTestOverride(null);
  });
});

describe("PROVIDER FAILURE", () => {
  it("empty compact leaves checkpoint unchanged", async () => {
    insertBlocksThrough(300);
    __setCompactCurrentMemoryTestOverride(async () => "");
    const before = readCheckpoint();
    const result = await runCompactAndGetResult();
    assert.equal(result.committed, false);
    const after = readCheckpoint();
    assert.equal(after.coveredThroughTurn, before.coveredThroughTurn);
    __setCompactCurrentMemoryTestOverride(null);
  });
});

async function runCompactAndGetResult() {
  const memory = getChatMemoryRow(CHAT)!;
  return executeGlobalLorebookCompaction({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: MEMORY_CAPACITY_FIXED,
    boundarySnapshot: getMemorySourceBoundary(CHAT),
    checkpointBeforePersist: readGlobalCheckpointSnapshot(memory),
    playableTurnCount: memory.summarized_turn_count ?? undefined,
    trigger: "post_seal",
  });
}

describe("MEDIUM N15 PARITY", () => {
  it("incremental global_compact keeps Medium ON", async () => {
    insertBlocksThrough(305);
    __setCompactCurrentMemoryTestOverride(async (input, max) => `COMPACT_${input.length}`.slice(0, max));
    await runCompact();
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "global_compact");
    assert.equal(shouldInjectMediumTermMemory(resolved.projectionKind), true);
    __setCompactCurrentMemoryTestOverride(null);
  });
});

describe("HISTORICAL MUTATION MATRIX", () => {
  beforeEach(async () => {
    insertBlocksThrough(300);
    __setCompactCurrentMemoryTestOverride(async (input, max) => `COMPACT_${input.length}`.slice(0, max));
    await runCompact();
    __setCompactCurrentMemoryTestOverride(null);
  });

  it("inactive/delete clears checkpoint metadata", () => {
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    markMemoryRecordInactive(CHAT, row.id);
    const cp = readCheckpoint();
    assert.equal(cp.projectionKind, null);
    assert.equal(cp.sourceFingerprint, null);
  });
});
