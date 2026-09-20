/**
 * Global incremental compaction architecture audit — zero provider calls.
 * Read-only simulation; does not implement runtime incremental folding.
 */
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  LOREBOOK_COMPACT_FILL_RATIO,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_TARGET_CHARS,
} from "./memory-constants";
import type { ChatMemoryRow } from "./memory-types";
import {
  buildGlobalSummarySourceFingerprintFromText,
  isGlobalSummarySourceFingerprintCurrent,
} from "./memory-global-source-fingerprint";
import {
  isGlobalCompactProjectionFresh,
  isManualGlobalProjectionFresh,
} from "./memory-global-projection";
import { resolveGlobalCurrentMemory } from "./memory-lorebook-resolve";
import {
  formatMemoryBlock,
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  type MemoryRecordView,
} from "./memory-turn-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";

export const COMPRESSION_DEPTH_MARKERS = {
  oldIdentity: "OLD_IDENTITY_FACT",
  oldRelationship: "OLD_RELATIONSHIP_MILESTONE",
  oldPromise: "OLD_PROMISE",
  midMajor: "MID_MAJOR_EVENT",
  recentMajor: "RECENT_MAJOR_EVENT",
} as const;

export type GlobalCompactionOwnerEntry = {
  responsibility: string;
  file: string;
  function: string;
  notes?: string;
};

/** Current-main Global compaction owner map (audit reference). */
export const GLOBAL_COMPACTION_OWNER_MAP: GlobalCompactionOwnerEntry[] = [
  {
    responsibility: "canonical granular source",
    file: "memory-turn-summary.ts",
    function: "listMemoryRecordsForChat / rebuildLorebookFromRecords",
  },
  {
    responsibility: "Global source rebuild",
    file: "memory-turn-summary.ts",
    function: "rebuildLorebookFromRecords",
  },
  {
    responsibility: "Global compact provider call",
    file: "memory-rolling-summary.ts",
    function: "compactCurrentMemory",
  },
  {
    responsibility: "post-seal compaction trigger",
    file: "memory-rolling-summary.ts",
    function: "persistBatchAndMaybeCompactLorebook (post-persist rebuild + compactCurrentMemory)",
  },
  {
    responsibility: "background compaction trigger",
    file: "memory-manager.ts",
    function: "scheduleBackgroundLorebookMaintenance",
  },
  {
    responsibility: "Global commit validation",
    file: "memory-global-source-fingerprint.ts",
    function: "canCommitGlobalSummaryProjection",
  },
  {
    responsibility: "Global source fingerprint (ephemeral at commit)",
    file: "memory-global-source-fingerprint.ts",
    function: "buildGlobalSummarySourceFingerprint / buildGlobalSummarySourceFingerprintFromText",
  },
  {
    responsibility: "Global projection read owner",
    file: "memory-lorebook-resolve.ts",
    function: "resolveGlobalCurrentMemory",
  },
  {
    responsibility: "Global invalidation owner",
    file: "memory-global-projection.ts",
    function: "refreshGlobalMemoryMirrorFromRecords",
  },
  {
    responsibility: "summary contiguous frontier",
    file: "memory-summary-integrity.ts",
    function: "highestContiguousCompletedTurn → summarized_turn_count",
  },
  {
    responsibility: "manual Global edit",
    file: "memory-manager.ts",
    function: "updateLorebookForChat → recent_summary user edit",
  },
  {
    responsibility: "Medium N15 source",
    file: "memory-medium-term.ts",
    function: "buildMediumTermMemoryBlockForProjection (MEDIUM_TERM_BLOCK_COUNT=15, global_compact only)",
  },
];

export type DeadDuplicateOwnerClassification =
  | "KEEP"
  | "CONSOLIDATE_CANDIDATE"
  | "SAFE_TO_DELETE"
  | "FOLLOW_UP";

export type DeadDuplicateOwnerEntry = {
  symbol: string;
  file: string;
  classification: DeadDuplicateOwnerClassification;
  notes: string;
};

/** Dead / duplicate owner audit — audit-only; no deletions in this PR. */
export const DEAD_DUPLICATE_OWNER_AUDIT: DeadDuplicateOwnerEntry[] = [
  {
    symbol: "compactCurrentMemory",
    file: "memory-rolling-summary.ts",
    classification: "KEEP",
    notes: "Single provider-call owner; invoked from post-seal and background paths.",
  },
  {
    symbol: "scheduleBackgroundLorebookMaintenance",
    file: "memory-manager.ts",
    classification: "KEEP",
    notes: "Background compaction trigger; shares canCommitGlobalSummaryProjection with post-seal.",
  },
  {
    symbol: "persistBatchAndMaybeCompactLorebook",
    file: "memory-rolling-summary.ts",
    classification: "KEEP",
    notes: "Post-seal compaction trigger owner.",
  },
  {
    symbol: "recentSummaryOverride",
    file: "memory-summary-persist.ts",
    classification: "KEEP",
    notes: "Test/internal override hook for persist path; not a duplicate compact owner.",
  },
  {
    symbol: "refreshGlobalMemoryMirrorFromRecords",
    file: "memory-global-projection.ts",
    classification: "KEEP",
    notes: "Invalidation/mirror refresh after canonical record mutation.",
  },
  {
    symbol: "post-seal vs background source construction",
    file: "memory-rolling-summary.ts + memory-manager.ts",
    classification: "CONSOLIDATE_CANDIDATE",
    notes: "Both rebuild via rebuildLorebookFromRecords then compactCurrentMemory; separate triggers by design.",
  },
  {
    symbol: "summarized_turn_count handling",
    file: "memory-summary-persist.ts + memory-summary-integrity.ts",
    classification: "FOLLOW_UP",
    notes: "Frontier counter can advance without committed Global compact; not a duplicate owner but coverage semantics gap.",
  },
];

export type DurableGlobalMetadataField =
  | "recent_summary"
  | "archive_summary"
  | "summarized_turn_count"
  | "memory_epoch"
  | "memory_reset_after_message_id"
  | "used_chars"
  | "membership_tier";

export type DurableMetadataAudit = {
  present: DurableGlobalMetadataField[];
  absent: string[];
  partial: string[];
};

export function auditDurableGlobalMetadataSchema(): DurableMetadataAudit {
  return {
    present: [
      "recent_summary",
      "archive_summary",
      "summarized_turn_count",
      "memory_epoch",
      "memory_reset_after_message_id",
      "used_chars",
      "membership_tier",
    ],
    absent: [
      "global_projection_kind",
      "global_source_fingerprint",
      "global_covered_through_turn",
      "global_checkpoint_generation",
      "global_covered_source_record_ids",
      "manual_vs_derived_ownership_flag",
    ],
    partial: [
      "recent_summary (stores projection text but not kind/fingerprint/coverage metadata)",
      "summarized_turn_count (contiguous seal frontier only — not Global compact coverage)",
    ],
  };
}

function padAuditBody(marker: string, chars = ROLLING_SUMMARY_TARGET_CHARS): string {
  let body = `${marker} → event → consequence`;
  while (body.length < chars) body += ` → ${marker}_PAD`;
  return body.slice(0, chars);
}

/** Deterministic lorebook rebuild size at turn — mirrors rebuildLorebookFromRecords shape. */
export function buildDeterministicRebuiltLorebook(currentTurn: number): string {
  const summarizedThrough =
    Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const blocks: string[] = [];
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= summarizedThrough;
    start += ROLLING_SUMMARY_INTERVAL
  ) {
    const end = start + ROLLING_SUMMARY_INTERVAL - 1;
    const marker =
      start <= 20
        ? COMPRESSION_DEPTH_MARKERS.oldIdentity
        : start <= 100
          ? COMPRESSION_DEPTH_MARKERS.midMajor
          : COMPRESSION_DEPTH_MARKERS.recentMajor;
    blocks.push(formatMemoryBlock(start, end, padAuditBody(`${marker}_T${start}`, ROLLING_SUMMARY_TARGET_CHARS)));
  }
  return blocks.join("\n\n");
}

export type FullHistoryGrowthReport = {
  currentTurn: number;
  sealedBlockCount: number;
  rebuiltInputChars: number;
  rebuiltInputTokens: number;
  globalOutputCap: number;
  sealCadenceTurns: number;
  overflowSealCount: number;
  estimatedCompactionCalls: number;
  overBudget: boolean;
};

export function measureFullHistoryGrowthAtTurn(currentTurn: number): FullHistoryGrowthReport {
  const rebuilt = buildDeterministicRebuiltLorebook(currentTurn);
  const summarizedThrough =
    Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
  const sealedBlockCount = summarizedThrough / ROLLING_SUMMARY_INTERVAL;

  let overflowSealCount = 0;
  let estimatedCompactionCalls = 0;
  let cumulative = "";
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= summarizedThrough;
    start += ROLLING_SUMMARY_INTERVAL
  ) {
    const end = start + ROLLING_SUMMARY_INTERVAL - 1;
    const marker =
      start <= 20
        ? COMPRESSION_DEPTH_MARKERS.oldIdentity
        : start <= 100
          ? COMPRESSION_DEPTH_MARKERS.midMajor
          : COMPRESSION_DEPTH_MARKERS.recentMajor;
    const block = formatMemoryBlock(
      start,
      end,
      padAuditBody(`${marker}_T${start}`, ROLLING_SUMMARY_TARGET_CHARS)
    );
    cumulative = cumulative ? `${cumulative}\n\n${block}` : block;
    if (cumulative.length > MEMORY_CAPACITY_FIXED) {
      overflowSealCount += 1;
      estimatedCompactionCalls += 1;
    }
  }

  return {
    currentTurn,
    sealedBlockCount,
    rebuiltInputChars: rebuilt.length,
    rebuiltInputTokens: estimateTokens(rebuilt || " "),
    globalOutputCap: MEMORY_CAPACITY_FIXED,
    sealCadenceTurns: ROLLING_SUMMARY_INTERVAL,
    overflowSealCount,
    estimatedCompactionCalls,
    overBudget: rebuilt.length > MEMORY_CAPACITY_FIXED,
  };
}

export type CheckpointOwnerClassification = {
  field: string;
  classification: "VALID_CHECKPOINT_OWNER" | "INSUFFICIENT" | "UNRELATED";
  reason: string;
};

export function classifyCheckpointOwnerCandidates(): CheckpointOwnerClassification[] {
  return [
    {
      field: "memory_epoch + memory_reset_after_message_id",
      classification: "VALID_CHECKPOINT_OWNER",
      reason: "Invalidates writes on reset/mutation — #969 race guard; does not prove compact coverage.",
    },
    {
      field: "buildGlobalSummarySourceFingerprint (in-memory at commit)",
      classification: "INSUFFICIENT",
      reason: "Proves source identity at commit time but is NOT persisted with recent_summary.",
    },
    {
      field: "summarized_turn_count",
      classification: "INSUFFICIENT",
      reason: "Highest contiguous sealed batch end — not Global compact coverage through turn.",
    },
    {
      field: "summary record source ids",
      classification: "INSUFFICIENT",
      reason: "Per-row provenance exists but no durable link from compact → covered record set.",
    },
    {
      field: "recent_summary text alone",
      classification: "INSUFFICIENT",
      reason: "No embedded kind/fingerprint/coverage; manual vs derived indistinguishable durably.",
    },
    {
      field: "updated_at",
      classification: "UNRELATED",
      reason: "#969 — timestamp freshness not valid for checkpoint identity.",
    },
  ];
}

export type NaiveIncrementalInput = {
  previousCompact: string;
  deltaBlocks: string;
  combinedInputChars: number;
  combinedInputTokens: number;
};

export function buildNaiveIncrementalInput(
  previousCompact: string,
  deltaBlocks: string[]
): NaiveIncrementalInput {
  const delta = deltaBlocks.join("\n\n");
  const combined = previousCompact.trim()
    ? `${previousCompact.trim()}\n\n${delta}`
    : delta;
  return {
    previousCompact,
    deltaBlocks: delta,
    combinedInputChars: combined.length,
    combinedInputTokens: estimateTokens(combined || " "),
  };
}

export type ArchitectureCostRow = {
  turn: number;
  architecture: "A_full_rebuild" | "B_previous_compact_plus_delta" | "C_checkpoint_plus_delta";
  compactInputChars: number;
  compactInputTokens: number;
  compactionCalls: number;
  cumulativeCompactInputTokens: number;
};

export function simulateArchitectureCostMatrix(
  turns: readonly number[]
): ArchitectureCostRow[] {
  const rows: ArchitectureCostRow[] = [];
  let cumulativeA = 0;
  let cumulativeB = 0;
  let cumulativeC = 0;
  let lastCompactB = "";
  let lastCompactC = "";
  let checkpointValidC = true;

  for (const currentTurn of turns) {
    const growth = measureFullHistoryGrowthAtTurn(currentTurn);
    cumulativeA += growth.rebuiltInputTokens * growth.estimatedCompactionCalls;

    const summarizedThrough =
      Math.floor((currentTurn - 1) / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
    const lastBlockStart =
      summarizedThrough > 0 ? summarizedThrough - ROLLING_SUMMARY_INTERVAL + 1 : 0;
    const deltaBlock =
      lastBlockStart > 0
        ? formatMemoryBlock(
            lastBlockStart,
            lastBlockStart + ROLLING_SUMMARY_INTERVAL - 1,
            padAuditBody(`DELTA_T${lastBlockStart}`)
          )
        : "";

    if (growth.overBudget && deltaBlock) {
      const naiveB = buildNaiveIncrementalInput(lastCompactB, [deltaBlock]);
      cumulativeB += naiveB.combinedInputTokens;
      lastCompactB = "x".repeat(Math.min(MEMORY_CAPACITY_FIXED, LOREBOOK_COMPACT_FILL_RATIO * MEMORY_CAPACITY_FIXED));

      if (checkpointValidC) {
        const naiveC = buildNaiveIncrementalInput(lastCompactC, [deltaBlock]);
        cumulativeC += naiveC.combinedInputTokens;
        lastCompactC = lastCompactB;
      } else {
        cumulativeC += growth.rebuiltInputTokens;
        lastCompactC = lastCompactB;
        checkpointValidC = true;
      }
    }

    rows.push({
      turn: currentTurn,
      architecture: "A_full_rebuild",
      compactInputChars: growth.rebuiltInputChars,
      compactInputTokens: growth.rebuiltInputTokens,
      compactionCalls: growth.estimatedCompactionCalls,
      cumulativeCompactInputTokens: cumulativeA,
    });
    rows.push({
      turn: currentTurn,
      architecture: "B_previous_compact_plus_delta",
      compactInputChars: growth.overBudget
        ? buildNaiveIncrementalInput(lastCompactB, deltaBlock ? [deltaBlock] : []).combinedInputChars
        : growth.rebuiltInputChars,
      compactInputTokens: growth.overBudget
        ? buildNaiveIncrementalInput(lastCompactB, deltaBlock ? [deltaBlock] : []).combinedInputTokens
        : growth.rebuiltInputTokens,
      compactionCalls: growth.estimatedCompactionCalls,
      cumulativeCompactInputTokens: cumulativeB,
    });
    rows.push({
      turn: currentTurn,
      architecture: "C_checkpoint_plus_delta",
      compactInputChars: growth.rebuiltInputChars,
      compactInputTokens: growth.rebuiltInputTokens,
      compactionCalls: growth.estimatedCompactionCalls,
      cumulativeCompactInputTokens: cumulativeC,
    });
  }
  return rows;
}

export function countRecompressionDepthNaiveIncremental(compactionCount: number): number {
  return Math.max(0, compactionCount);
}

export function summarizeSummarizedTurnCountSemantics(
  chatId: number,
  records: MemoryRecordView[],
  playableTurnCount: number,
  storedRecentSummary: string,
  maxChars: number
): {
  summarizedTurnCount: number;
  globalCompactCoversThrough: boolean;
  frontierAdvancesWithoutGlobalCompact: boolean;
} {
  const summarizedTurnCount = highestContiguousCompletedTurn(records, playableTurnCount);
  const resolved = resolveGlobalCurrentMemory(chatId, maxChars, {
    storedRecentSummary,
  });
  const rebuilt = rebuildLorebookFromRecords(chatId).trim();
  const storedRepresentsCanonicalSource =
    storedRecentSummary.trim().length > 0 && storedRecentSummary.trim() === rebuilt;
  return {
    summarizedTurnCount,
    globalCompactCoversThrough: storedRepresentsCanonicalSource,
    frontierAdvancesWithoutGlobalCompact:
      summarizedTurnCount > 0 && !storedRepresentsCanonicalSource,
  };
}

export function inspectChatMemoryRow(row: ChatMemoryRow): {
  hasRecentSummary: boolean;
  hasSummarizedTurnCount: boolean;
  hasMemoryEpoch: boolean;
  hasProjectionKind: boolean;
  hasSourceFingerprint: boolean;
  hasCoveredThroughTurn: boolean;
} {
  return {
    hasRecentSummary: Boolean(row.recent_summary?.trim()),
    hasSummarizedTurnCount: row.summarized_turn_count != null,
    hasMemoryEpoch: row.memory_epoch != null,
    hasProjectionKind: false,
    hasSourceFingerprint: false,
    hasCoveredThroughTurn: false,
  };
}

export function canSchemaProveAppendOnlyCheckpoint(opts: {
  storedCompact: string;
  rebuiltThroughTurn: string;
  deltaBlock: string;
  fingerprintAtCommit: string;
  chatId: number;
}): {
  provable: boolean;
  missingRequirements: string[];
} {
  const missing: string[] = [];
  if (!opts.storedCompact.trim()) missing.push("durable compact checkpoint text");
  if (!opts.rebuiltThroughTurn.trim()) missing.push("canonical source through checkpoint turn");
  if (!opts.fingerprintAtCommit) missing.push("source fingerprint at checkpoint commit");
  if (
    opts.fingerprintAtCommit &&
    !isGlobalSummarySourceFingerprintCurrent(opts.chatId, opts.fingerprintAtCommit)
  ) {
    missing.push("persisted fingerprint matching canonical source (not stored durably)");
  }
  missing.push("global_covered_through_turn persisted with compact");
  missing.push("global_projection_kind persisted (exact vs global_compact vs manual_global)");
  missing.push("checkpoint survives restart with identity metadata");
  return { provable: false, missingRequirements: missing };
}

export function detectHistoricalEditInNaiveIncremental(
  previousCompact: string,
  editedMarker: string
): boolean {
  return previousCompact.includes(editedMarker);
}

export function classifyManualGlobalIncrementalSemantics(
  rebuilt: string,
  storedManual: string,
  maxChars: number
): "PROVEN" | "AMBIGUOUS" {
  const isManual = isManualGlobalProjectionFresh(0, rebuilt, storedManual, maxChars);
  if (!isManual) return "PROVEN";
  return "AMBIGUOUS";
}

export function isGlobalCompactFreshAfterSourceChange(
  chatId: number,
  rebuilt: string,
  storedCompact: string,
  maxChars: number
): boolean {
  return isGlobalCompactProjectionFresh(chatId, rebuilt, storedCompact, maxChars);
}

export function buildFingerprintForText(text: string): string {
  return buildGlobalSummarySourceFingerprintFromText(text);
}
