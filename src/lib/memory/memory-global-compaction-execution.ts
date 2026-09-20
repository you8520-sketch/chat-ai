import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import type { MemoryTier } from "./memory-types";
import { getChatMemoryRow } from "./memory-db";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import {
  buildCanonicalDeltaSourceAfterCheckpoint,
  buildIncrementalCompactInput,
  commitExactGlobalMirrorCore,
  commitGlobalCompactCheckpointCore,
  evaluateIncrementalAppendEligibility,
  fingerprintForCoveredThroughTurn,
  fullCanonicalSourceFingerprint,
  isCheckpointMetadataCurrentInDb,
  readGlobalCheckpointSnapshot,
  resolveCanonicalCompactFrontier,
  type GlobalCheckpointInvalidReason,
  type GlobalCheckpointSnapshot,
} from "./memory-global-checkpoint";
import {
  canCommitGlobalSummaryProjection,
  buildGlobalSummarySourceFingerprintFromText,
} from "./memory-global-source-fingerprint";
import { isMechanicalEmergencyTrim } from "./memory-global-projection";
import {
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";
import { compactCurrentMemory } from "./memory-rolling-summary";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";

export type GlobalCompactExecutionMode = "none" | "full_rebuild" | "incremental_append";

export type GlobalCompactPlan = {
  mode: GlobalCompactExecutionMode;
  compactInput: string;
  checkpointSnapshot: GlobalCheckpointSnapshot | null;
  sourceFingerprintBefore: string;
  boundarySnapshot: MemorySourceBoundary;
  targetCoveredThrough: number;
  invalidReason?: GlobalCheckpointInvalidReason;
  rebuiltSource: string;
};

export type GlobalCompactExecutionResult = {
  committed: boolean;
  mode: GlobalCompactExecutionMode;
  invalidReason?: GlobalCheckpointInvalidReason;
  coveredThroughBefore: number | null;
  coveredThroughAfter: number | null;
  compactInputChars: number;
};

function buildGlobalCompactPlan(opts: {
  chatId: number;
  lorebookBudget: number;
  boundarySnapshot: MemorySourceBoundary;
  checkpointBeforePersist: GlobalCheckpointSnapshot;
  playableTurnCount?: number;
}): GlobalCompactPlan {
  const rebuiltSource = rebuildLorebookFromRecords(opts.chatId).trim();
  const sourceFingerprintBefore = buildGlobalSummarySourceFingerprintFromText(rebuiltSource);
  const targetCoveredThrough = resolveCanonicalCompactFrontier(
    opts.chatId,
    opts.playableTurnCount
  );

  if (!rebuiltSource || rebuiltSource.length <= opts.lorebookBudget) {
    return {
      mode: "none",
      compactInput: rebuiltSource,
      checkpointSnapshot: opts.checkpointBeforePersist,
      sourceFingerprintBefore,
      boundarySnapshot: opts.boundarySnapshot,
      targetCoveredThrough,
      rebuiltSource,
    };
  }

  const incremental = evaluateIncrementalAppendEligibility({
    chatId: opts.chatId,
    checkpoint: opts.checkpointBeforePersist,
    canonicalFrontier: targetCoveredThrough,
  });

  if (incremental.eligible && opts.checkpointBeforePersist.coveredThroughTurn != null) {
    const delta = buildCanonicalDeltaSourceAfterCheckpoint(
      opts.chatId,
      opts.checkpointBeforePersist.coveredThroughTurn
    );
    return {
      mode: "incremental_append",
      compactInput: buildIncrementalCompactInput(
        opts.checkpointBeforePersist.compactText,
        delta
      ),
      checkpointSnapshot: opts.checkpointBeforePersist,
      sourceFingerprintBefore,
      boundarySnapshot: opts.boundarySnapshot,
      targetCoveredThrough,
      rebuiltSource,
    };
  }

  return {
    mode: "full_rebuild",
    compactInput: rebuiltSource,
    checkpointSnapshot: opts.checkpointBeforePersist,
    sourceFingerprintBefore,
    boundarySnapshot: opts.boundarySnapshot,
    targetCoveredThrough,
    invalidReason: incremental.reason,
    rebuiltSource,
  };
}

function canCommitIncrementalGlobalCompact(opts: {
  db: Database.Database;
  chatId: number;
  boundarySnapshot: MemorySourceBoundary;
  sourceFingerprintBefore: string;
  checkpointSnapshot: GlobalCheckpointSnapshot;
  sourceUserMessageIds?: number[];
}): boolean {
  if (
    !canCommitGlobalSummaryProjection({
      db: opts.db,
      chatId: opts.chatId,
      boundarySnapshot: opts.boundarySnapshot,
      sourceFingerprintBefore: opts.sourceFingerprintBefore,
      sourceUserMessageIds: opts.sourceUserMessageIds,
    })
  ) {
    return false;
  }
  if (!opts.checkpointSnapshot.coveredThroughTurn) return false;
  if (
    !isCheckpointMetadataCurrentInDb(opts.db, opts.chatId, opts.checkpointSnapshot)
  ) {
    return false;
  }
  const prefixNow = fingerprintForCoveredThroughTurn(
    opts.chatId,
    opts.checkpointSnapshot.coveredThroughTurn
  );
  return prefixNow === opts.checkpointSnapshot.sourceFingerprint;
}

function logGlobalCompactExecution(payload: Record<string, unknown>): void {
  console.info("GLOBAL_COMPACT_EXECUTION", payload);
}

/**
 * Canonical Global compaction execution owner — post-seal and background paths delegate here.
 */
export async function executeGlobalLorebookCompaction(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  memoryCapacity: number;
  boundarySnapshot: MemorySourceBoundary;
  sourceUserMessageIds?: number[];
  checkpointBeforePersist?: GlobalCheckpointSnapshot | null;
  playableTurnCount?: number;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  trigger: "post_seal" | "background";
}): Promise<GlobalCompactExecutionResult> {
  const db = getDb();
  const lorebookBudget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  const memoryRow = getChatMemoryRow(opts.chatId);
  const checkpointBeforePersist =
    opts.checkpointBeforePersist ??
    readGlobalCheckpointSnapshot(
      memoryRow ?? {
        recent_summary: "",
        global_projection_kind: null,
        global_source_fingerprint: null,
        global_covered_through_turn: null,
      } as never
    );

  const coveredThroughBefore = checkpointBeforePersist.coveredThroughTurn;

  if (
    !isMemoryWriteGuardCurrentCore(db, {
      chatId: opts.chatId,
      snapshot: opts.boundarySnapshot,
      sourceUserMessageIds: opts.sourceUserMessageIds ?? [],
    })
  ) {
    return {
      committed: false,
      mode: "none",
      coveredThroughBefore,
      coveredThroughAfter: coveredThroughBefore,
      compactInputChars: 0,
      invalidReason: "checkpoint_metadata_stale",
    };
  }

  const plan = buildGlobalCompactPlan({
    chatId: opts.chatId,
    lorebookBudget,
    boundarySnapshot: opts.boundarySnapshot,
    checkpointBeforePersist,
    playableTurnCount: opts.playableTurnCount,
  });

  if (plan.mode === "none") {
    if (plan.rebuiltSource && plan.rebuiltSource !== memoryRow?.recent_summary) {
      const archive = memoryRow?.archive_summary ?? "";
      db.transaction(() => {
        if (
          !isMemoryWriteGuardCurrentCore(db, {
            chatId: opts.chatId,
            snapshot: opts.boundarySnapshot,
            sourceUserMessageIds: opts.sourceUserMessageIds ?? [],
          })
        ) {
          return false;
        }
        commitExactGlobalMirrorCore(db, {
          chatId: opts.chatId,
          exactText: plan.rebuiltSource,
          archiveSummary: archive,
          summarizedTurnCount: plan.targetCoveredThrough,
        });
        return true;
      }).immediate();
    }
    return {
      committed: true,
      mode: "none",
      coveredThroughBefore,
      coveredThroughAfter: null,
      compactInputChars: 0,
    };
  }

  let compactedText = "";
  try {
    compactedText = (await compactCurrentMemory(plan.compactInput, lorebookBudget, opts.turnTrace)).trim();
  } catch (e) {
    console.warn(
      `[memory] global compact skipped (${opts.trigger}):`,
      (e as Error).message
    );
    logGlobalCompactExecution({
      trigger: opts.trigger,
      mode: plan.mode,
      committed: false,
      invalidReason: "provider_failure",
      coveredThroughBefore,
    });
    return {
      committed: false,
      mode: plan.mode,
      coveredThroughBefore,
      coveredThroughAfter: coveredThroughBefore,
      compactInputChars: plan.compactInput.length,
    };
  }

  if (
    !compactedText ||
    isMechanicalEmergencyTrim(plan.rebuiltSource, compactedText, lorebookBudget)
  ) {
    logGlobalCompactExecution({
      trigger: opts.trigger,
      mode: plan.mode,
      committed: false,
      invalidReason: "provider_failure",
      coveredThroughBefore,
    });
    return {
      committed: false,
      mode: plan.mode,
      coveredThroughBefore,
      coveredThroughAfter: coveredThroughBefore,
      compactInputChars: plan.compactInput.length,
    };
  }

  const newFingerprint = fingerprintForCoveredThroughTurn(opts.chatId, plan.targetCoveredThrough);
  const archive = memoryRow?.archive_summary ?? "";

  const committed = db.transaction(() => {
    const canCommit =
      plan.mode === "incremental_append" && plan.checkpointSnapshot
        ? canCommitIncrementalGlobalCompact({
            db,
            chatId: opts.chatId,
            boundarySnapshot: opts.boundarySnapshot,
            sourceFingerprintBefore: plan.sourceFingerprintBefore,
            checkpointSnapshot: plan.checkpointSnapshot,
            sourceUserMessageIds: opts.sourceUserMessageIds,
          })
        : canCommitGlobalSummaryProjection({
            db,
            chatId: opts.chatId,
            boundarySnapshot: opts.boundarySnapshot,
            sourceFingerprintBefore: plan.sourceFingerprintBefore,
            sourceUserMessageIds: opts.sourceUserMessageIds,
          });

    if (!canCommit) return false;

    commitGlobalCompactCheckpointCore(db, {
      chatId: opts.chatId,
      compactText: compactedText,
      archiveSummary: archive,
      coveredThroughTurn: plan.targetCoveredThrough,
      sourceFingerprint: newFingerprint,
    });
    return true;
  }).immediate();

  logGlobalCompactExecution({
    trigger: opts.trigger,
    mode: plan.mode,
    committed,
    coveredThroughBefore,
    coveredThroughAfter: committed ? plan.targetCoveredThrough : coveredThroughBefore,
    compactInputChars: plan.compactInput.length,
    compactInputTokensEstimate: Math.ceil(plan.compactInput.length / 1.1),
    invalidReason: committed ? undefined : plan.invalidReason ?? "checkpoint_metadata_stale",
  });

  return {
    committed,
    mode: plan.mode,
    invalidReason: committed ? undefined : plan.invalidReason ?? "checkpoint_metadata_stale",
    coveredThroughBefore,
    coveredThroughAfter: committed ? plan.targetCoveredThrough : coveredThroughBefore,
    compactInputChars: plan.compactInput.length,
  };
}

export { buildGlobalCompactPlan, fullCanonicalSourceFingerprint };
