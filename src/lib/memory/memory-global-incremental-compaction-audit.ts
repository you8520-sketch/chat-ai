/**
 * Global incremental compaction architecture audit — zero provider calls.
 * Read-only simulation; does not implement runtime incremental folding.
 */
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  LOREBOOK_COMPACT_FILL_RATIO,
  ROLLING_SUMMARY_INTERVAL,
  ROLLING_SUMMARY_TARGET_CHARS,
} from "./memory-constants";
import type { ChatMemoryRow } from "./memory-types";
import {
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { USER_NOTE_FOCUS_MAX, USER_NOTE_REFERENCE_MAX } from "@/lib/persona";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  assembleMovingGlobalCompactStub,
  assembleMovingMediumRingText,
} from "./memory-medium-term-audit";
import { MEDIUM_TERM_BLOCK_COUNT } from "./memory-medium-term";
import { USER_NOTE_REFERENCE_INJECT_MAX_CHARS } from "@/lib/userNoteReferenceInjector";
import { USER_NOTE_ZONE_SEPARATOR } from "@/lib/userNoteStatusWindow";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";
import {
  buildGlobalSummarySourceFingerprint,
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
  listPromptInjectibleMemoryRecords,
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

function sealedThroughForTurn(currentTurn: number): number {
  return Math.floor(currentTurn / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL;
}

function buildDeterministicBlocksThroughSealedTurn(sealedThrough: number): string[] {
  const blocks: string[] = [];
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= sealedThrough;
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
  return blocks;
}

/** Canonical deterministic source through an exact sealed-through turn (seal simulation). */
export function buildDeterministicSourceThroughSealedTurn(sealedThrough: number): string {
  return buildDeterministicBlocksThroughSealedTurn(sealedThrough).join("\n\n");
}

/** Deterministic lorebook rebuild size at turn — mirrors rebuildLorebookFromRecords shape. */
export function buildDeterministicRebuiltLorebook(currentTurn: number): string {
  return buildDeterministicSourceThroughSealedTurn(sealedThroughForTurn(currentTurn));
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

function blockMarkerForStart(start: number): string {
  return start <= 20
    ? COMPRESSION_DEPTH_MARKERS.oldIdentity
    : start <= 100
      ? COMPRESSION_DEPTH_MARKERS.midMajor
      : COMPRESSION_DEPTH_MARKERS.recentMajor;
}

function buildLatestBlockAtSealedThrough(sealedThrough: number): string {
  if (sealedThrough <= 0) return "";
  const start = sealedThrough - ROLLING_SUMMARY_INTERVAL + 1;
  const end = sealedThrough;
  return formatMemoryBlock(
    start,
    end,
    padAuditBody(`${blockMarkerForStart(start)}_T${start}`, ROLLING_SUMMARY_TARGET_CHARS)
  );
}

function compactOutputStubChars(globalCapacity: number): number {
  return Math.min(globalCapacity, Math.floor(LOREBOOK_COMPACT_FILL_RATIO * globalCapacity));
}

export type SealBySealCostSnapshot = {
  targetTurn: number;
  globalCapacity: number;
  globalOutputTargetChars: number;
  firstOverflowSealTurn: number | null;
  compactionCallCount: number;
  latestCallInputChars: number;
  latestCallInputTokens: number;
  cumulativeCompactInputTokensA: number;
  cumulativeCompactInputTokensB: number;
  cumulativeCompactInputTokensC: number;
  /** Theoretical only — B/C correctness unproven without durable checkpoint schema. */
  theoreticalInputSavingsBVsA: number | null;
  bCorrectness: "CORRECTNESS_UNPROVEN";
  cCorrectness: "CORRECTNESS_UNPROVEN";
};

/** Seal-by-seal simulation — sums actual per-overflow compact input tokens. */
export function simulateSealBySealCompactionCosts(
  targetTurn: number,
  globalCapacity = MEMORY_CAPACITY_FIXED
): SealBySealCostSnapshot {
  let cumulativeA = 0;
  let cumulativeB = 0;
  let cumulativeC = 0;
  let compactionCalls = 0;
  let lastCompactStub = "";
  let latestInputTokens = 0;
  let latestInputChars = 0;
  let firstOverflowSeal: number | null = null;
  const outputStub = "x".repeat(compactOutputStubChars(globalCapacity));

  for (
    let sealedThrough = ROLLING_SUMMARY_INTERVAL;
    sealedThrough <= sealedThroughForTurn(targetTurn);
    sealedThrough += ROLLING_SUMMARY_INTERVAL
  ) {
    const source = buildDeterministicSourceThroughSealedTurn(sealedThrough);
    if (source.length <= globalCapacity) continue;

    compactionCalls += 1;
    if (firstOverflowSeal == null) firstOverflowSeal = sealedThrough;

    const inputTokens = estimateTokens(source);
    latestInputTokens = inputTokens;
    latestInputChars = source.length;
    cumulativeA += inputTokens;

    const deltaBlock = buildLatestBlockAtSealedThrough(sealedThrough);
    const naiveB = buildNaiveIncrementalInput(lastCompactStub, [deltaBlock]);
    cumulativeB += naiveB.combinedInputTokens;
    cumulativeC += naiveB.combinedInputTokens;
    lastCompactStub = outputStub;
  }

  return {
    targetTurn,
    globalCapacity,
    globalOutputTargetChars: globalCapacity,
    firstOverflowSealTurn: firstOverflowSeal,
    compactionCallCount: compactionCalls,
    latestCallInputChars: latestInputChars,
    latestCallInputTokens: latestInputTokens,
    cumulativeCompactInputTokensA: cumulativeA,
    cumulativeCompactInputTokensB: cumulativeB,
    cumulativeCompactInputTokensC: cumulativeC,
    theoreticalInputSavingsBVsA:
      cumulativeA > 0 ? Math.round((1 - cumulativeB / cumulativeA) * 100) : null,
    bCorrectness: "CORRECTNESS_UNPROVEN",
    cCorrectness: "CORRECTNESS_UNPROVEN",
  };
}

export type ArchitectureCostRow = {
  turn: number;
  architecture: "A_full_rebuild" | "B_previous_compact_plus_delta" | "C_checkpoint_plus_delta";
  compactInputChars: number;
  compactInputTokens: number;
  compactionCalls: number;
  cumulativeCompactInputTokens: number;
  savingsClassification: "ACTUAL_FULL_REBUILD" | "THEORETICAL_INPUT_SAVINGS";
};

export function simulateArchitectureCostMatrix(
  turns: readonly number[],
  globalCapacity = MEMORY_CAPACITY_FIXED
): ArchitectureCostRow[] {
  const rows: ArchitectureCostRow[] = [];
  for (const currentTurn of turns) {
    const snapshot = simulateSealBySealCompactionCosts(currentTurn, globalCapacity);
    rows.push({
      turn: currentTurn,
      architecture: "A_full_rebuild",
      compactInputChars: snapshot.latestCallInputChars,
      compactInputTokens: snapshot.latestCallInputTokens,
      compactionCalls: snapshot.compactionCallCount,
      cumulativeCompactInputTokens: snapshot.cumulativeCompactInputTokensA,
      savingsClassification: "ACTUAL_FULL_REBUILD",
    });
    rows.push({
      turn: currentTurn,
      architecture: "B_previous_compact_plus_delta",
      compactInputChars: snapshot.latestCallInputChars,
      compactInputTokens: snapshot.latestCallInputTokens,
      compactionCalls: snapshot.compactionCallCount,
      cumulativeCompactInputTokens: snapshot.cumulativeCompactInputTokensB,
      savingsClassification: "THEORETICAL_INPUT_SAVINGS",
    });
    rows.push({
      turn: currentTurn,
      architecture: "C_checkpoint_plus_delta",
      compactInputChars: snapshot.latestCallInputChars,
      compactInputTokens: snapshot.latestCallInputTokens,
      compactionCalls: snapshot.compactionCallCount,
      cumulativeCompactInputTokens: snapshot.cumulativeCompactInputTokensC,
      savingsClassification: "THEORETICAL_INPUT_SAVINGS",
    });
  }
  return rows;
}

export type GlobalCapacityEvidenceRow = SealBySealCostSnapshot & {
  wholeHistoryCoverageMarkers: string[];
};

export function simulateGlobalCapacityEvidenceMatrix(
  turns: readonly number[],
  capacities: readonly number[]
): GlobalCapacityEvidenceRow[] {
  const rows: GlobalCapacityEvidenceRow[] = [];
  for (const capacity of capacities) {
    for (const turn of turns) {
      const snapshot = simulateSealBySealCompactionCosts(turn, capacity);
      rows.push({
        ...snapshot,
        wholeHistoryCoverageMarkers: [
          COMPRESSION_DEPTH_MARKERS.oldIdentity,
          COMPRESSION_DEPTH_MARKERS.midMajor,
          COMPRESSION_DEPTH_MARKERS.recentMajor,
        ],
      });
    }
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

/** Prefix fingerprint — canonical owner: buildGlobalSummarySourceFingerprint + excludeTurnStartGte. */
export function buildPrefixFingerprintThroughTurn(
  chatId: number,
  coveredThroughTurn: number
): string {
  return buildGlobalSummarySourceFingerprint(chatId, {
    excludeTurnStartGte: coveredThroughTurn + 1,
  });
}

export function listCanonicalDeltaRecordsAfterTurn(
  chatId: number,
  coveredThroughTurn: number
): MemoryRecordView[] {
  return listPromptInjectibleMemoryRecords(chatId).filter(
    (record) => record.turnStart > coveredThroughTurn
  );
}

export type MinimumCheckpointMetadataAudit = {
  minimumNewFields: readonly string[];
  globalProjectionKindRequired: boolean;
  globalPrefixFingerprintRequired: boolean;
  globalCoveredThroughRequired: boolean;
  globalCheckpointGenerationRequired: boolean;
  durablePersistedKinds: readonly string[];
  runtimeOnlyKinds: readonly string[];
  rationale: string;
};

export function auditMinimumCheckpointMetadata(): MinimumCheckpointMetadataAudit {
  return {
    minimumNewFields: [
      "global_projection_kind",
      "global_source_fingerprint",
      "global_covered_through_turn",
    ],
    globalProjectionKindRequired: true,
    globalPrefixFingerprintRequired: true,
    globalCoveredThroughRequired: true,
    globalCheckpointGenerationRequired: false,
    durablePersistedKinds: ["global_compact", "manual_global"],
    runtimeOnlyKinds: ["exact", "failure_fallback", "stored_fallback"],
    rationale:
      "Prefix fingerprint (canonical injectible source through coveredThrough) + coveredThrough + " +
      "projection kind disambiguate durable recent_summary. Separate generation integer is not required " +
      "when commit validates memory boundary + prefix fingerprint + frontier/coveredThrough alignment.",
  };
}

export type MemoryEpochClassification = {
  role: "stale derived-write / memory-boundary guard";
  validAsCheckpointGeneration: boolean;
  validAsCoveredThrough: boolean;
  validAsPrefixFingerprint: boolean;
  bumpsOnEveryCanonicalMutation: boolean;
  classification: "VALID" | "INVALID" | "PARTIAL";
};

export function auditMemoryEpochSemantics(): MemoryEpochClassification {
  return {
    role: "stale derived-write / memory-boundary guard",
    validAsCheckpointGeneration: false,
    validAsCoveredThrough: false,
    validAsPrefixFingerprint: false,
    bumpsOnEveryCanonicalMutation: false,
    classification: "INVALID",
  };
}

export type CheckpointGenerationNecessity = {
  required: boolean;
  sufficientGuards: string[];
  failureWithoutGeneration: string | null;
};

export function auditCheckpointGenerationNecessity(): CheckpointGenerationNecessity {
  return {
    required: false,
    sufficientGuards: [
      "memory_epoch + reset boundary CAS (#969)",
      "prefix fingerprint at commit (buildGlobalSummarySourceFingerprint excludeTurnStartGte)",
      "global_covered_through_turn vs contiguous frontier at commit",
      "canCommitGlobalSummaryProjection full-source guard for non-incremental races",
    ],
    failureWithoutGeneration:
      "Concurrent incremental commits for same coveredThrough need metadata CAS on fingerprint+coveredThrough; " +
      "generation integer is optional if commit compares stored fingerprint+coveredThrough atomically.",
  };
}

export type InvalidationPathEntry = {
  mutation: string;
  reachesRefreshMirror: boolean;
  bumpsMemoryEpoch: boolean;
  wouldClearCheckpointMetadata: boolean;
  owner: string;
};

export const GLOBAL_CHECKPOINT_INVALIDATION_PATHS: InvalidationPathEntry[] = [
  {
    mutation: "record edit (updateMemoryRecordById)",
    reachesRefreshMirror: true,
    bumpsMemoryEpoch: false,
    wouldClearCheckpointMetadata: false,
    owner: "memory-turn-summary.ts → refreshGlobalMemoryMirrorFromRecords",
  },
  {
    mutation: "record inactive/delete (markMemoryRecordInactive)",
    reachesRefreshMirror: true,
    bumpsMemoryEpoch: false,
    wouldClearCheckpointMetadata: false,
    owner: "memory-turn-summary.ts → refreshGlobalMemoryMirrorFromRecords",
  },
  {
    mutation: "regen (assistant regen path)",
    reachesRefreshMirror: false,
    bumpsMemoryEpoch: true,
    wouldClearCheckpointMetadata: false,
    owner: "memory-manager.ts → invalidateDerivedMemoryGeneration",
  },
  {
    mutation: "manual Global edit (updateLorebookForChat)",
    reachesRefreshMirror: false,
    bumpsMemoryEpoch: true,
    wouldClearCheckpointMetadata: false,
    owner: "memory-manager.ts → invalidateDerivedMemoryGeneration",
  },
  {
    mutation: "branch reopen/close/adopt",
    reachesRefreshMirror: true,
    bumpsMemoryEpoch: false,
    wouldClearCheckpointMetadata: false,
    owner: "memory-turn-summary.ts / memory-summary-persist.ts",
  },
  {
    mutation: "reset",
    reachesRefreshMirror: false,
    bumpsMemoryEpoch: true,
    wouldClearCheckpointMetadata: false,
    owner: "memory-source-boundary.ts → reset boundary + epoch",
  },
  {
    mutation: "variant switch",
    reachesRefreshMirror: false,
    bumpsMemoryEpoch: true,
    wouldClearCheckpointMetadata: false,
    owner: "memory-variant-switch-reconcile.ts → invalidateDerivedMemoryGenerationCore",
  },
];

export function classifyInvalidationOwnerCompleteness(): "SINGLE" | "DUPLICATED" | "INCOMPLETE" {
  const hasMirror = GLOBAL_CHECKPOINT_INVALIDATION_PATHS.some((p) => p.reachesRefreshMirror);
  const hasEpoch = GLOBAL_CHECKPOINT_INVALIDATION_PATHS.some((p) => p.bumpsMemoryEpoch);
  const clearsCheckpoint = GLOBAL_CHECKPOINT_INVALIDATION_PATHS.some(
    (p) => p.wouldClearCheckpointMetadata
  );
  if (!clearsCheckpoint) return "INCOMPLETE";
  if (hasMirror && hasEpoch) return "DUPLICATED";
  if (hasMirror || hasEpoch) return "SINGLE";
  return "INCOMPLETE";
}

export type AtomicCommitOwnerAudit = {
  location: string;
  function: string;
  currentFields: string[];
  futureRequiredFields: string[];
  atomic: boolean;
};

export function auditAtomicCompactCommitOwner(): AtomicCommitOwnerAudit {
  return {
    location: "memory-rolling-summary.ts",
    function: "persistBatchAndMaybeCompactLorebook → db.transaction + updateChatMemory",
    currentFields: ["recent_summary"],
    futureRequiredFields: [
      "recent_summary",
      "global_projection_kind",
      "global_source_fingerprint",
      "global_covered_through_turn",
    ],
    atomic: true,
  };
}

export type SubscriptionEvidenceConfigId = "CURRENT" | "PAID_A" | "PAID_B";

export type SubscriptionEvidenceConfig = {
  id: SubscriptionEvidenceConfigId;
  globalCapacityChars: number;
  focusMaxChars: number;
  referenceStorageMaxChars: number;
  referenceInjectMaxChars: number;
  mediumBlockCount: number;
};

export const SUBSCRIPTION_EVIDENCE_CONFIGS: SubscriptionEvidenceConfig[] = [
  {
    id: "CURRENT",
    globalCapacityChars: 10_000,
    focusMaxChars: USER_NOTE_FOCUS_MAX,
    referenceStorageMaxChars: 5_000,
    referenceInjectMaxChars: USER_NOTE_REFERENCE_INJECT_MAX_CHARS,
    mediumBlockCount: MEDIUM_TERM_BLOCK_COUNT,
  },
  {
    id: "PAID_A",
    globalCapacityChars: 15_000,
    focusMaxChars: 2_000,
    referenceStorageMaxChars: 15_000,
    referenceInjectMaxChars: 3_500,
    mediumBlockCount: MEDIUM_TERM_BLOCK_COUNT,
  },
  {
    id: "PAID_B",
    globalCapacityChars: 20_000,
    focusMaxChars: 2_000,
    referenceStorageMaxChars: 20_000,
    referenceInjectMaxChars: 4_000,
    mediumBlockCount: MEDIUM_TERM_BLOCK_COUNT,
  },
];

function padToChars(text: string, chars: number): string {
  let body = text;
  while (body.length < chars) body += " → PAD";
  return body.slice(0, chars);
}

function buildSubscriptionUserNote(config: SubscriptionEvidenceConfig): string {
  const focus = padToChars("FOCUS_ZONE audit keyword 폭우 역", config.focusMaxChars);
  const referenceStorage = padToChars(
    "REFERENCE_STORAGE audit keyword 폭우 abandoned_station — not fully injected",
    config.referenceStorageMaxChars
  );
  return focus + USER_NOTE_ZONE_SEPARATOR + referenceStorage;
}

export function buildSubscriptionPromptBudgetInput(opts: {
  modelId: string;
  config: SubscriptionEvidenceConfig;
  currentTurn: number;
}): ContextBuildInput {
  const globalText = padToChars(
    assembleMovingGlobalCompactStub(opts.currentTurn),
    opts.config.globalCapacityChars
  );
  const mediumText = assembleMovingMediumRingText(
    opts.currentTurn,
    opts.config.mediumBlockCount as 15
  );
  return {
    charName: "AuditChar",
    userNickname: "AuditUser",
    personaDisplayName: "AuditUser",
    chunks: [
      {
        id: "audit-identity",
        characterId: "audit-char",
        category: "identity",
        content: padToChars("[Identity] representative Main RP canon body.", 4_500),
        importance: "CRITICAL",
        tokenCount: estimateTokens("identity"),
        keywords: [],
      },
    ],
    userPersona: padToChars("User persona block.", 900),
    userNote: buildSubscriptionUserNote(opts.config),
    shortTermHistory: [
      { role: "user", content: "폭우 역 audit keyword continue".padEnd(800, "가") },
      { role: "assistant", content: "폭우 역 audit reply".padEnd(800, "가") },
    ],
    currentUserMessage: "폭우 abandoned_station audit keyword continue the scene",
    nsfw: false,
    provider: selectedAIProvider(opts.modelId as SelectedAI),
    modelId: opts.modelId,
    longTermMemory: globalText,
    mediumTermMemoryBlock: mediumText,
    memoryMeta: padToChars('{"promises":["약속"]}', 1_800),
    episodicMemoryBlock: padToChars("[Episodic] audit fact", 980),
    targetResponseChars: 2500,
    completedTurns: opts.currentTurn,
  };
}

export type SubscriptionPromptMatrixRow = {
  configId: SubscriptionEvidenceConfigId;
  modelId: string;
  globalCapacityChars: number;
  referenceStorageMaxChars: number;
  referenceInjectMaxChars: number;
  estimatedSystemTokens: number;
  estimatedHistoryTokens: number;
  estimatedInputTokens: number;
  tokenBudget: number;
  deltaSystemTokensVsCurrent: number;
  deltaInputTokensVsCurrent: number;
  telemetryTargetCrossing: boolean;
  truncatedMemory: boolean;
  criticalSectionOmitted: boolean;
};

export function buildSubscriptionFullPromptMatrix(
  currentTurn = 300
): SubscriptionPromptMatrixRow[] {
  const rows: SubscriptionPromptMatrixRow[] = [];
  const baselines = new Map<
    string,
    { systemTokens: number; inputTokens: number }
  >();

  for (const modelId of MAIN_RP_MODEL_IDS) {
    const currentBuilt = buildContext(
      buildSubscriptionPromptBudgetInput({
        modelId,
        config: SUBSCRIPTION_EVIDENCE_CONFIGS.find((c) => c.id === "CURRENT")!,
        currentTurn,
      })
    );
    baselines.set(modelId, {
      systemTokens: currentBuilt.meta.estimatedSystemTokens,
      inputTokens:
        currentBuilt.meta.estimatedInputTokens ??
        currentBuilt.meta.estimatedSystemTokens + currentBuilt.meta.estimatedHistoryTokens,
    });
  }

  for (const config of SUBSCRIPTION_EVIDENCE_CONFIGS) {
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const built = buildContext(
        buildSubscriptionPromptBudgetInput({ modelId, config, currentTurn })
      );
      const systemTokens = built.meta.estimatedSystemTokens;
      const historyTokens = built.meta.estimatedHistoryTokens;
      const inputTokens =
        built.meta.estimatedInputTokens ?? systemTokens + historyTokens;
      const budget = built.meta.tokenBudget;
      const tracked = new Set((built.meta.trackedSections ?? []).map((s) => s.id));
      const baseline = baselines.get(modelId)!;
      rows.push({
        configId: config.id,
        modelId,
        globalCapacityChars: config.globalCapacityChars,
        referenceStorageMaxChars: config.referenceStorageMaxChars,
        referenceInjectMaxChars: config.referenceInjectMaxChars,
        estimatedSystemTokens: systemTokens,
        estimatedHistoryTokens: historyTokens,
        estimatedInputTokens: inputTokens,
        tokenBudget: budget,
        deltaSystemTokensVsCurrent: systemTokens - baseline.systemTokens,
        deltaInputTokensVsCurrent: inputTokens - baseline.inputTokens,
        telemetryTargetCrossing: systemTokens > budget,
        truncatedMemory: built.meta.truncatedMemory === true,
        criticalSectionOmitted:
          !tracked.has("current-memory") || !tracked.has("medium-term-memory"),
      });
    }
  }
  return rows;
}

export type SubscriptionDowngradeRisk = {
  dimension: string;
  requiresDestructiveTruncation: boolean;
  requiresRecompression: boolean;
  readOnlyOverflowPreservation: boolean;
  editingLockRequired: boolean;
  schemaChangeRequired: boolean;
  preferredPolicy: string;
};

export function auditSubscriptionDowngradeSemantics(): SubscriptionDowngradeRisk[] {
  return [
    {
      dimension: "Global 15K/20K → 10K stored compact",
      requiresDestructiveTruncation: false,
      requiresRecompression: true,
      readOnlyOverflowPreservation: true,
      editingLockRequired: false,
      schemaChangeRequired: true,
      preferredPolicy:
        "Preserve user-authored text read-only; recompress on next overflow seal — do not delete canonical summaries.",
    },
    {
      dimension: "Focus 2K → 1K",
      requiresDestructiveTruncation: true,
      requiresRecompression: false,
      readOnlyOverflowPreservation: true,
      editingLockRequired: false,
      schemaChangeRequired: false,
      preferredPolicy: "Truncate focus zone with user edit opportunity — do not silent delete.",
    },
    {
      dimension: "User Lorebook storage 15K/20K → 5K",
      requiresDestructiveTruncation: false,
      requiresRecompression: false,
      readOnlyOverflowPreservation: true,
      editingLockRequired: true,
      schemaChangeRequired: true,
      preferredPolicy: "Storage overflow read-only; per-turn injection cap drops separately (2.5K free).",
    },
    {
      dimension: "Per-turn reference injection 3.5K/4K → 2.5K",
      requiresDestructiveTruncation: false,
      requiresRecompression: false,
      readOnlyOverflowPreservation: true,
      editingLockRequired: false,
      schemaChangeRequired: false,
      preferredPolicy: "Injection cap only — storage unchanged.",
    },
  ];
}

export type AuditCodeHygieneEntry = {
  symbol: string;
  classification: "DURABLE_REGRESSION" | "ONE_OFF_FORENSIC" | "IMPLEMENTATION_FIXTURE";
  longTermPlan: string;
};

export const AUDIT_CODE_HYGIENE: AuditCodeHygieneEntry[] = [
  {
    symbol: "buildPrefixFingerprintThroughTurn",
    classification: "IMPLEMENTATION_FIXTURE",
    longTermPlan: "Move to memory-global-source-fingerprint when schema lands.",
  },
  {
    symbol: "simulateSealBySealCompactionCosts",
    classification: "ONE_OFF_FORENSIC",
    longTermPlan: "Remove after incremental implementation PR or keep as regression if promoted.",
  },
  {
    symbol: "GLOBAL_COMPACTION_OWNER_MAP",
    classification: "ONE_OFF_FORENSIC",
    longTermPlan: "Documentation-only — extract to architecture doc or delete post-implementation.",
  },
  {
    symbol: "prefix fingerprint append-only / historical mutation tests",
    classification: "DURABLE_REGRESSION",
    longTermPlan: "Keep minimal fixtures in memory-global-compact-race or new checkpoint test file.",
  },
  {
    symbol: "buildSubscriptionFullPromptMatrix",
    classification: "ONE_OFF_FORENSIC",
    longTermPlan: "Remove after subscription policy decision; not runtime.",
  },
];

export function verifyUserNoteCurrentMainConstants(): {
  focusMax: number;
  referenceStorageMax: number;
  referenceInjectMax: number;
} {
  return {
    focusMax: USER_NOTE_FOCUS_MAX,
    referenceStorageMax: USER_NOTE_REFERENCE_MAX,
    referenceInjectMax: USER_NOTE_REFERENCE_INJECT_MAX_CHARS,
  };
}
