import {
  buildBatchSourceFingerprint,
  memorySourceFingerprintStillValid,
  snapshotMemorySourceFingerprint,
} from "./memory-source-fingerprint";
import { loadMemoryEligibleChatTurnsWithMessageIdsCore } from "./memory-turn-loader";
import {
  getMemorySourceBoundaryCore,
  isMemoryWriteGuardCurrentCore,
  type MemorySourceBoundary,
} from "./memory-source-boundary";

export type BatchSourceGuardInput = {
  chatId: number;
  batchStart: number;
  batchEnd: number;
  boundarySnapshot?: MemorySourceBoundary;
  sourceUserMessageIds?: readonly (number | null | undefined)[];
};

export type BatchSourceGuardSnapshot = {
  boundary: MemorySourceBoundary;
  batchFingerprint: string;
  fullFingerprint: ReturnType<typeof snapshotMemorySourceFingerprint>;
};

export function snapshotBatchSourceGuard(
  db: import("better-sqlite3").Database,
  input: BatchSourceGuardInput
): BatchSourceGuardSnapshot {
  const boundary =
    input.boundarySnapshot ?? getMemorySourceBoundaryCore(db, input.chatId);
  const eligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
    db,
    input.chatId,
    boundary
  );
  return {
    boundary,
    batchFingerprint: buildBatchSourceFingerprint(
      eligible,
      input.batchStart,
      input.batchEnd
    ),
    fullFingerprint: snapshotMemorySourceFingerprint(eligible, boundary),
  };
}

export function isBatchSourceGuardCurrent(
  db: import("better-sqlite3").Database,
  input: BatchSourceGuardInput,
  before: BatchSourceGuardSnapshot
): boolean {
  const boundary = getMemorySourceBoundaryCore(db, input.chatId);
  const eligible = loadMemoryEligibleChatTurnsWithMessageIdsCore(
    db,
    input.chatId,
    boundary
  );
  if (
    !memorySourceFingerprintStillValid(
      before.fullFingerprint,
      eligible,
      boundary
    )
  ) {
    return false;
  }
  if (
    buildBatchSourceFingerprint(eligible, input.batchStart, input.batchEnd) !==
    before.batchFingerprint
  ) {
    return false;
  }
  if (
    !isMemoryWriteGuardCurrentCore(db, {
      chatId: input.chatId,
      snapshot: before.boundary,
      sourceUserMessageIds: input.sourceUserMessageIds,
    })
  ) {
    return false;
  }
  return true;
}

export function batchSourceMessageIds(
  eligible: readonly import("./memory-turn-loader").ChatTurnWithMessageIds[],
  batchStart: number,
  batchEnd: number
): { userMessageIds: number[]; assistantMessageIds: number[] } {
  const batch = eligible.filter(
    (turn) => turn.turnNumber >= batchStart && turn.turnNumber <= batchEnd
  );
  return {
    userMessageIds: batch
      .map((turn) => turn.userMessageId)
      .filter((id): id is number => id != null),
    assistantMessageIds: batch.map((turn) => turn.assistantMessageId),
  };
}
