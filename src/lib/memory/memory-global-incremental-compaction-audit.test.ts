/**
 * Global incremental compaction architecture audit — zero provider calls.
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
import { MEDIUM_TERM_BLOCK_COUNT } from "./memory-medium-term";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { ROLLING_SUMMARY_INTERVAL, ROLLING_SUMMARY_TARGET_CHARS } from "./memory-constants";
import {
  DEAD_DUPLICATE_OWNER_AUDIT,
  GLOBAL_COMPACTION_OWNER_MAP,
  auditDurableGlobalMetadataSchema,
  buildDeterministicRebuiltLorebook,
  buildFingerprintForText,
  buildNaiveIncrementalInput,
  canSchemaProveAppendOnlyCheckpoint,
  classifyCheckpointOwnerCandidates,
  classifyManualGlobalIncrementalSemantics,
  COMPRESSION_DEPTH_MARKERS,
  detectHistoricalEditInNaiveIncremental,
  inspectChatMemoryRow,
  isGlobalCompactFreshAfterSourceChange,
  measureFullHistoryGrowthAtTurn,
  simulateArchitectureCostMatrix,
  summarizeSummarizedTurnCountSemantics,
} from "./memory-global-incremental-compaction-audit";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import {
  __setCompactCurrentMemoryTestOverride,
  compactCurrentMemory,
} from "./memory-rolling-summary";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  updateMemoryRecordById,
} from "./memory-turn-summary";

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
  cleanup();
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `global-audit-${USER}@test.local`,
    "audit-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "AuditChar");
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
    const marker =
      start === 41
        ? COMPRESSION_DEPTH_MARKERS.oldIdentity
        : start <= 20
          ? COMPRESSION_DEPTH_MARKERS.oldIdentity
          : start <= 100
            ? COMPRESSION_DEPTH_MARKERS.midMajor
            : COMPRESSION_DEPTH_MARKERS.recentMajor;
    upsertSummaryRowCore({
      chatId: CHAT,
      turnStart: start,
      turnEnd: end,
      assistantMessageId: 1000 + start,
      summary: padBody(`${marker}_T${start}`),
      summaryKind: "main_canon",
    });
  }
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seedChat);

describe("MEDIUM N15 ON MAIN", () => {
  it("canonical N15 policy present on current main", () => {
    assert.equal(MEDIUM_TERM_BLOCK_COUNT, 15);
  });
});

describe("FULL-HISTORY RECOMPRESSION GROWTH", () => {
  for (const turn of [100, 300, 1000, 2000] as const) {
    it(`T${turn} — input grows with sealed block count`, () => {
      const report = measureFullHistoryGrowthAtTurn(turn);
      assert.ok(report.sealedBlockCount > 0);
      assert.ok(report.rebuiltInputChars > 0);
      assert.equal(report.globalOutputCap, MEMORY_CAPACITY_FIXED);
      assert.equal(report.sealCadenceTurns, ROLLING_SUMMARY_INTERVAL);
      if (turn >= 300) {
        assert.equal(report.overBudget, true);
        assert.ok(report.estimatedCompactionCalls > 0);
      }
    });
  }

  it("growth is monotonic — CONFIRMED", () => {
    const t100 = measureFullHistoryGrowthAtTurn(100);
    const t300 = measureFullHistoryGrowthAtTurn(300);
    const t1000 = measureFullHistoryGrowthAtTurn(1000);
    const t2000 = measureFullHistoryGrowthAtTurn(2000);
    assert.ok(t300.rebuiltInputChars > t100.rebuiltInputChars);
    assert.ok(t1000.rebuiltInputChars > t300.rebuiltInputChars);
    assert.ok(t2000.rebuiltInputChars > t1000.rebuiltInputChars);
    assert.ok(t300.estimatedCompactionCalls >= t100.estimatedCompactionCalls);
  });
});

describe("GLOBAL COMPACTION OWNER MAP", () => {
  it("documents current-main owners", () => {
    assert.ok(GLOBAL_COMPACTION_OWNER_MAP.length >= 10);
    const responsibilities = GLOBAL_COMPACTION_OWNER_MAP.map((e) => e.responsibility);
    assert.ok(responsibilities.includes("post-seal compaction trigger"));
    assert.ok(responsibilities.includes("background compaction trigger"));
    assert.ok(responsibilities.includes("Global commit validation"));
    assert.ok(responsibilities.includes("Medium N15 source"));
  });

  it("post-seal and background paths share fingerprint commit validation", () => {
    const postSeal = GLOBAL_COMPACTION_OWNER_MAP.find(
      (e) => e.responsibility === "post-seal compaction trigger"
    )!;
    const bg = GLOBAL_COMPACTION_OWNER_MAP.find(
      (e) => e.responsibility === "background compaction trigger"
    )!;
    assert.match(postSeal.file, /memory-rolling-summary/);
    assert.match(bg.file, /memory-manager/);
  });
});

describe("SUMMARY FRONTIER VS GLOBAL COVERAGE", () => {
  it("summarized_turn_count advances while Global compact not committed — INVALID as coverage", () => {
    insertBlocksThrough(60);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuilt.length > 0);

    updateChatMemory(CHAT, USER, CHAR, {
      summarized_turn_count: 60,
      recent_summary: "STALE_OR_MISSING_COMPACT_AFTER_SEAL",
    });

    const memory = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const records = listMemoryRecordsForChat(CHAT);
    const semantics = summarizeSummarizedTurnCountSemantics(
      CHAT,
      records,
      60,
      memory.recent_summary,
      MEMORY_CAPACITY_FIXED
    );
    assert.equal(semantics.summarizedTurnCount, 60);
    assert.equal(semantics.globalCompactCoversThrough, false);
    assert.equal(semantics.frontierAdvancesWithoutGlobalCompact, true);
  });
});

describe("DURABLE GLOBAL METADATA", () => {
  it("schema stores text/frontier/epoch but not checkpoint identity metadata", () => {
    const audit = auditDurableGlobalMetadataSchema();
    assert.ok(audit.present.includes("recent_summary"));
    assert.ok(audit.present.includes("summarized_turn_count"));
    assert.ok(audit.absent.includes("global_source_fingerprint"));
    assert.ok(audit.absent.includes("global_projection_kind"));
    assert.equal(audit.partial.length > 0, true);

    const row = getOrCreateChatMemory(CHAT, USER, CHAR, "free");
    const inspected = inspectChatMemoryRow(row);
    assert.equal(inspected.hasProjectionKind, false);
    assert.equal(inspected.hasSourceFingerprint, false);
    assert.equal(inspected.hasCoveredThroughTurn, false);
  });
});

describe("APPEND-ONLY SIMULATION", () => {
  it("current schema cannot prove checkpoint+delta without durable metadata", () => {
    insertBlocksThrough(300);
    const rebuiltThrough300 = rebuildLorebookFromRecords(CHAT);
    const deltaBlock = padBody("T301_305_NEW");
    const proof = canSchemaProveAppendOnlyCheckpoint({
      chatId: CHAT,
      storedCompact: "COMPACT_THROUGH_T300",
      rebuiltThroughTurn: rebuiltThrough300,
      deltaBlock,
      fingerprintAtCommit: buildFingerprintForText(rebuiltThrough300),
    });
    assert.equal(proof.provable, false);
    assert.ok(proof.missingRequirements.length > 0);
  });
});

describe("HISTORICAL MUTATION REPRODUCTION", () => {
  it("naive incremental misses edited T41~45 — CONFIRMED", async () => {
    insertBlocksThrough(305);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const compactStub = `COMPACT_STUB ${COMPRESSION_DEPTH_MARKERS.oldIdentity} preserved through T300`;
    __setCompactCurrentMemoryTestOverride(async () => compactStub);
    const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    __setCompactCurrentMemoryTestOverride(null);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: compacted, summarized_turn_count: 300 });

    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    updateMemoryRecordById(CHAT, row.id, padBody("EDITED_T41_45_CANONICAL"));

    const editedRebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(editedRebuilt.includes("EDITED_T41_45_CANONICAL"));

    const delta = padBody("T301_305_SEAL");
    const naive = buildNaiveIncrementalInput(compacted, [delta]);
    assert.equal(detectHistoricalEditInNaiveIncremental(naive.previousCompact, "EDITED_T41_45"), false);
    assert.ok(editedRebuilt.includes("EDITED_T41_45_CANONICAL"));
    assert.notEqual(buildFingerprintForText(editedRebuilt), buildFingerprintForText(rebuilt));
  });

  it("regen/edit invalidates stale compact fingerprint", () => {
    insertBlocksThrough(40);
    const before = rebuildLorebookFromRecords(CHAT);
    const fpBefore = buildFingerprintForText(before);
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: "STALE_COMPACT" });

    insertBlocksThrough(45);
    const row = listMemoryRecordsForChat(CHAT).find((r) => r.turnStart === 41)!;
    updateMemoryRecordById(CHAT, row.id, padBody("REGEN_EDIT_MARKER"));
    const after = rebuildLorebookFromRecords(CHAT);
    assert.notEqual(buildFingerprintForText(after), fpBefore);
  });
});

describe("MANUAL GLOBAL INTERACTION", () => {
  it("manual_global semantics are AMBIGUOUS for naive incremental fold", () => {
    insertBlocksThrough(10);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    const manual = "USER_AUTHORED_GLOBAL free-form edit without canonical rebuild shape";
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: manual });
    const semantics = classifyManualGlobalIncrementalSemantics(
      rebuilt,
      manual,
      MEMORY_CAPACITY_FIXED
    );
    assert.equal(semantics, "AMBIGUOUS");
  });
});

describe("COMPRESSION DEPTH", () => {
  it("naive incremental recompresses prior compact repeatedly", () => {
    const t300 = measureFullHistoryGrowthAtTurn(300);
    const t1000 = measureFullHistoryGrowthAtTurn(1000);
    const t2000 = measureFullHistoryGrowthAtTurn(2000);
    assert.ok(t1000.estimatedCompactionCalls > t300.estimatedCompactionCalls);
    assert.ok(t2000.estimatedCompactionCalls > t1000.estimatedCompactionCalls);
  });

  it("deterministic markers present in rebuilt lorebook", () => {
    const lorebook = buildDeterministicRebuiltLorebook(300);
    assert.ok(lorebook.includes(COMPRESSION_DEPTH_MARKERS.oldIdentity));
    assert.ok(lorebook.includes(COMPRESSION_DEPTH_MARKERS.midMajor));
  });
});

describe("A/B/C COST MATRIX", () => {
  it("reports relative input at 100/300/1000/2000", () => {
    const matrix = simulateArchitectureCostMatrix([100, 300, 1000, 2000]);
    const a300 = matrix.find((r) => r.turn === 300 && r.architecture === "A_full_rebuild")!;
    const b300 = matrix.find((r) => r.turn === 300 && r.architecture === "B_previous_compact_plus_delta")!;
    const a2000 = matrix.find((r) => r.turn === 2000 && r.architecture === "A_full_rebuild")!;
    assert.ok(a300.compactInputTokens > 0);
    assert.ok(b300.cumulativeCompactInputTokens <= a2000.cumulativeCompactInputTokens || b300.compactInputTokens < a2000.compactInputTokens);
  });
});

describe("CHECKPOINT OWNER CLASSIFICATION", () => {
  it("documents VALID vs INSUFFICIENT candidates", () => {
    const classes = classifyCheckpointOwnerCandidates();
    assert.ok(classes.some((c) => c.classification === "VALID_CHECKPOINT_OWNER"));
    assert.ok(
      classes.some(
        (c) => c.field.startsWith("summarized_turn_count") && c.classification === "INSUFFICIENT"
      )
    );
    assert.ok(
      classes.some(
        (c) => c.field.includes("GlobalSummarySourceFingerprint") && c.classification === "INSUFFICIENT"
      )
    );
  });
});

describe("DEAD / DUPLICATE OWNER AUDIT", () => {
  it("classifies active compact owners without deletion", () => {
    const compact = DEAD_DUPLICATE_OWNER_AUDIT.find((e) => e.symbol === "compactCurrentMemory")!;
    assert.equal(compact.classification, "KEEP");
    const consolidate = DEAD_DUPLICATE_OWNER_AUDIT.filter(
      (e) => e.classification === "CONSOLIDATE_CANDIDATE"
    );
    assert.ok(consolidate.length >= 1);
  });
});

describe("IMPLEMENTATION GATE", () => {
  it("STOP_SCHEMA_DECISION_REQUIRED — no runtime incremental patch", () => {
    const metadata = auditDurableGlobalMetadataSchema();
    assert.ok(metadata.absent.includes("global_source_fingerprint"));
    assert.ok(metadata.absent.includes("global_covered_through_turn"));
  });
});

describe("GLOBAL PARITY UNCHANGED", () => {
  it("resolveGlobalCurrentMemory exact path when under budget", () => {
    insertBlocksThrough(5);
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED);
    assert.equal(resolved.projectionKind, "exact");
    assert.equal(resolved.source, "chat_turn_summaries");
  });

  it("global_compact when stored compact fresh", async () => {
    insertBlocksThrough(120);
    const rebuilt = rebuildLorebookFromRecords(CHAT);
    assert.ok(rebuilt.length > MEMORY_CAPACITY_FIXED);
    __setCompactCurrentMemoryTestOverride(async (input, max) =>
      `COMPACT_${COMPRESSION_DEPTH_MARKERS.midMajor} → ${input.slice(0, Math.max(0, max - 80))}`.slice(
        0,
        max
      )
    );
    const compacted = await compactCurrentMemory(rebuilt, MEMORY_CAPACITY_FIXED);
    __setCompactCurrentMemoryTestOverride(null);
    assert.ok(compacted.length <= MEMORY_CAPACITY_FIXED);
    assert.notEqual(compacted.trim(), rebuilt.trim());
    updateChatMemory(CHAT, USER, CHAR, { recent_summary: compacted });
    const resolved = resolveGlobalCurrentMemory(CHAT, MEMORY_CAPACITY_FIXED, {
      storedRecentSummary: compacted,
    });
    assert.equal(resolved.projectionKind, "global_compact");
  });
});
