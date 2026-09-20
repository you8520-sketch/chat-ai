/**
 * Production persist-path checkpoint consistency — zero provider calls.
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
  classifyCheckpointProjectionState,
  commitGlobalCompactCheckpointCore,
  readGlobalCheckpointSnapshot,
  resolveCanonicalCompactFrontier,
} from "./memory-global-checkpoint";
import {
  buildGlobalCompactPlan,
  executeGlobalLorebookCompaction,
} from "./memory-global-compaction-execution";
import { getChatMemoryRow, getOrCreateChatMemory } from "./memory-db";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import { getMemorySourceBoundary } from "./memory-source-boundary";
import {
  __setCompactCurrentMemoryTestOverride,
} from "./memory-rolling-summary";
import {
  persistValidatedSummaryBatch,
  upsertSummaryRowCore,
} from "./memory-summary-persist";
import { buildOocOnlyBatchPlaceholder } from "./memory-summary-integrity";
import type { PersistPendingBranchControlOp } from "./memory-branch-control";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
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
    `persist-${USER}@test.local`,
    "persist-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "PersistChar");
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

function insertBlocksThrough(endTurn: number, kind: "main_canon" | "empty_ooc" | "noncanon" | "branch_canon" = "main_canon"): void {
  for (let start = 1; start + ROLLING_SUMMARY_INTERVAL - 1 <= endTurn; start += ROLLING_SUMMARY_INTERVAL) {
    const end = start + ROLLING_SUMMARY_INTERVAL - 1;
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: start,
      turnEnd: end,
      assistantMessageId: 3000 + start,
      summary: kind === "empty_ooc" ? buildOocOnlyBatchPlaceholder(start, end) : padBody(`BLOCK_T${start}`),
      summaryKind: kind,
      userEdited: false,
    });
  }
}

function seedHealthyCheckpointThrough(
  throughTurn: number,
  compactMarker = "<<COMPACT_ANCHOR_T300>>"
): void {
  insertBlocksThrough(throughTurn);
  const fingerprint = buildPrefixFingerprintThroughTurn(CHAT, throughTurn);
  const memory = getChatMemoryRow(CHAT)!;
  commitGlobalCompactCheckpointCore(getDb(), {
    chatId: CHAT,
    compactText: compactMarker,
    archiveSummary: memory.archive_summary ?? "",
    coveredThroughTurn: throughTurn,
    sourceFingerprint: fingerprint,
  });
}

function seedLargeHealthyCheckpointThrough(throughTurn: number): string {
  insertBlocksThrough(throughTurn);
  const compactText = "<<COMPACT_ANCHOR_T300>> ".repeat(620).slice(0, 9900);
  const fingerprint = buildPrefixFingerprintThroughTurn(CHAT, throughTurn);
  const memory = getChatMemoryRow(CHAT)!;
  commitGlobalCompactCheckpointCore(getDb(), {
    chatId: CHAT,
    compactText,
    archiveSummary: memory.archive_summary ?? "",
    coveredThroughTurn: throughTurn,
    sourceFingerprint: fingerprint,
  });
  return compactText;
}

function persistBatch(turnStart: number, turnEnd: number, summary?: string) {
  return persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart,
    turnEnd,
    assistantMessageId: 4000 + turnStart,
    summary: summary ?? padBody(`<<DELTA_ANCHOR_T${turnStart}>>`),
    summaryKind: "main_canon",
    playableTurnCount: Math.max(turnEnd, 320),
  });
}

function countMarker(text: string, marker: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(marker, idx)) !== -1) {
    count += 1;
    idx += marker.length;
  }
  return count;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seedChat);

describe("POST-SEAL CHECKPOINT PERSIST CONSISTENCY", () => {
  it("pure append via persistValidatedSummaryBatch preserves healthy T300 checkpoint", () => {
    seedHealthyCheckpointThrough(300, "<<COMPACT_ANCHOR_T300>>");
    const before = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);

    const result = persistBatch(301, 305);
    assert.equal(result.ok, true);

    const row = getChatMemoryRow(CHAT)!;
    const after = readGlobalCheckpointSnapshot(row);
    assert.equal(classifyCheckpointProjectionState(row, { chatId: CHAT }), "derived_compact");
    assert.equal(after.compactText, "<<COMPACT_ANCHOR_T300>>");
    assert.equal(after.projectionKind, "global_compact");
    assert.equal(after.coveredThroughTurn, 300);
    assert.equal(after.sourceFingerprint, before.sourceFingerprint);
    assert.notEqual(row.recent_summary, rebuildLorebookFromRecords(CHAT));
    assert.equal(row.summarized_turn_count, 305);
  });

  it("detects invalid mixed projection that old persist path would create", () => {
    seedHealthyCheckpointThrough(300, "<<COMPACT_ANCHOR_T300>>");
    const db = getDb();
    const fullRebuild = rebuildLorebookFromRecords(CHAT);
    db.prepare(
      `UPDATE chat_memories SET recent_summary=? WHERE chat_id=?`
    ).run(fullRebuild, CHAT);
    const mixed = getChatMemoryRow(CHAT)!;
    assert.equal(classifyCheckpointProjectionState(mixed, { chatId: CHAT }), "invalid_mixed");
  });

  it("historical reseal clears checkpoint metadata atomically", () => {
    seedHealthyCheckpointThrough(300, "COMPACT_T300_MARKER");
    const row41 = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    const reseal = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 41,
      turnEnd: 45,
      assistantMessageId: 5000,
      summary: padBody("RESEAL_T41"),
      summaryKind: "main_canon",
      playableTurnCount: 305,
    });
    assert.equal(reseal.ok, true);
    const after = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    assert.equal(after.projectionKind, null);
    assert.equal(after.sourceFingerprint, null);
    assert.equal(after.coveredThroughTurn, null);
    assert.equal(classifyCheckpointProjectionState(getChatMemoryRow(CHAT)!), "no_projection");
  });
});

describe("INCREMENTAL DELTA DUPLICATION (production persist path)", () => {
  it("compact input contains previous compact once and T301..305 delta once", () => {
    seedHealthyCheckpointThrough(300, "<<COMPACT_ANCHOR_T300>>");
    const checkpointBeforePersist = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    const deltaSummary = `<<DELTA_ANCHOR_T301>>${"·".repeat(ROLLING_SUMMARY_TARGET_CHARS)}`;
    assert.equal(persistBatch(301, 305, deltaSummary).ok, true);

    const plan = buildGlobalCompactPlan({
      chatId: CHAT,
      lorebookBudget: MEMORY_CAPACITY_FIXED,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist,
      playableTurnCount: 305,
    });
    assert.equal(plan.mode, "incremental_append");
    assert.equal(countMarker(plan.compactInput, "<<COMPACT_ANCHOR_T300>>"), 1);
    assert.equal(countMarker(plan.compactInput, "<<DELTA_ANCHOR_T301>>"), 1);
    assert.equal(countMarker(plan.compactInput, "BLOCK_T1"), 0);
    assert.equal(countMarker(plan.compactInput, "BLOCK_T296"), 0);
  });
});

describe("NON-INJECTIBLE GAP COVERAGE", () => {
  it("CASE A: empty_ooc gap does not stall coveredThrough at 5", () => {
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 1,
      summary: padBody("MAIN_T1"),
      summaryKind: "main_canon",
      userEdited: false,
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 6,
      turnEnd: 10,
      assistantMessageId: 2,
      summary: buildOocOnlyBatchPlaceholder(6, 10),
      summaryKind: "empty_ooc",
      userEdited: false,
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 11,
      turnEnd: 15,
      assistantMessageId: 3,
      summary: padBody("MAIN_T11"),
      summaryKind: "main_canon",
      userEdited: false,
    });
    assert.equal(resolveCanonicalCompactFrontier(CHAT), 15);
    assert.equal(rebuildLorebookFromRecords(CHAT).includes("MAIN_T11"), true);
  });

  it("CASE B: noncanon between main blocks uses max injectible turnEnd", () => {
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 1,
      summary: padBody("MAIN_T1"),
      summaryKind: "main_canon",
      userEdited: false,
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 6,
      turnEnd: 10,
      assistantMessageId: 2,
      summary: padBody("NONCANON_T6"),
      summaryKind: "noncanon",
      userEdited: false,
    });
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: 11,
      turnEnd: 15,
      assistantMessageId: 3,
      summary: padBody("MAIN_T11"),
      summaryKind: "main_canon",
      userEdited: false,
    });
    assert.equal(resolveCanonicalCompactFrontier(CHAT), 15);
  });
});

describe("DURABLE CHECKPOINT VALIDATION FAIL-CLOSED", () => {
  it("wrong fingerprint with compact-like stored text fails closed", () => {
    insertBlocksThrough(300);
    assert.ok(rebuildLorebookFromRecords(CHAT).length > MEMORY_CAPACITY_FIXED);
    const storedCompactLike = "BOUNDED_COMPACT_LIKE_TEXT".padEnd(9000, "x");
    const db = getDb();
    db.prepare(
      `UPDATE chat_memories SET
        recent_summary=?,
        global_projection_kind='global_compact',
        global_source_fingerprint=?,
        global_covered_through_turn=?
       WHERE chat_id=?`
    ).run(storedCompactLike, "deadbeef".repeat(8), 300, CHAT);

    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.notEqual(resolved.projectionKind, "global_compact");
    assert.equal(resolved.projectionKind, "failure_fallback");
    assert.equal(resolved.needsBackgroundCompact, true);
  });
});

describe("PROVIDER FAILURE AFTER PURE APPEND", () => {
  it("append persists summaries while checkpoint stays at T300 for retry", async () => {
    const compactText = seedLargeHealthyCheckpointThrough(300);
    const checkpointBeforePersist = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    assert.equal(persistBatch(301, 305).ok, true);

    __setCompactCurrentMemoryTestOverride(async () => "");
    const result = await executeGlobalLorebookCompaction({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: MEMORY_CAPACITY_FIXED,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist,
      playableTurnCount: 305,
      trigger: "post_seal",
    });
    __setCompactCurrentMemoryTestOverride(null);

    assert.equal(result.committed, false);
    const after = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    assert.equal(after.compactText, compactText);
    assert.equal(after.coveredThroughTurn, 300);
    assert.equal(after.sourceFingerprint, checkpointBeforePersist.sourceFingerprint);
    assert.equal(listMemoryRecordsForChat(CHAT).some((r) => r.turnStart === 301), true);

    const retryPlan = buildGlobalCompactPlan({
      chatId: CHAT,
      lorebookBudget: MEMORY_CAPACITY_FIXED,
      boundarySnapshot: getMemorySourceBoundary(CHAT),
      checkpointBeforePersist: after,
      playableTurnCount: 305,
    });
    assert.equal(retryPlan.mode, "incremental_append");
  });
});

describe("BRANCH CONTROL INSIDE PERSIST", () => {
  it("reopen branch during persist clears checkpoint metadata", () => {
    const branchText =
      "분기 persist: 카페 IF가 이어지며 약속을 잡았다. ".repeat(8);
    const branchPayload = {
      v: 1 as const,
      scopes: { branch_canon: branchText },
      branchId: "branch-persist",
      branchStatus: "closed" as const,
      promotedBy: "user_continue",
      promotedAt: "2026-01-01T00:00:00.000Z",
    };
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: 6001,
      summary: branchText,
      summaryKind: "branch_canon",
      scopePayload: branchPayload,
      branchId: "branch-persist",
      branchStatus: "closed",
      promotedBy: "user_continue",
      promotedAt: "2026-01-01T00:00:00.000Z",
      playableTurnCount: 320,
    });
    for (let start = 6; start + ROLLING_SUMMARY_INTERVAL - 1 <= 300; start += ROLLING_SUMMARY_INTERVAL) {
      const end = start + ROLLING_SUMMARY_INTERVAL - 1;
      upsertSummaryRowCore({
        chatId: CHAT,
        turnStart: start,
        turnEnd: end,
        assistantMessageId: 6000 + start,
        summary: padBody(`BLOCK_T${start}`),
        summaryKind: "main_canon",
        userEdited: false,
      });
    }
    const fingerprint = buildPrefixFingerprintThroughTurn(CHAT, 300);
    commitGlobalCompactCheckpointCore(getDb(), {
      chatId: CHAT,
      compactText: "<<COMPACT_ANCHOR_T300>>",
      archiveSummary: "",
      coveredThroughTurn: 300,
      sourceFingerprint: fingerprint,
    });

    const pendingOps: PersistPendingBranchControlOp[] = [
      {
        op: "reopen_branch",
        branchId: "branch-persist",
        sourceTurn: 12,
        control: {
          source: "user_turn",
          sourceUserMessageId: 999,
          sourceTurn: 12,
          sourceBatchStart: 301,
        },
      },
    ];
    const result = persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 301,
      turnEnd: 305,
      assistantMessageId: 6002,
      summary: padBody("MAIN_AFTER_BRANCH"),
      summaryKind: "main_canon",
      playableTurnCount: 320,
      pendingBranchControlOps: pendingOps,
    });
    assert.equal(result.ok, true);
    const after = readGlobalCheckpointSnapshot(getChatMemoryRow(CHAT)!);
    assert.equal(after.projectionKind, null);
    assert.equal(after.sourceFingerprint, null);
    assert.equal(after.coveredThroughTurn, null);
  });
});
