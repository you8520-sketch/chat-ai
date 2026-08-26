import { createHash } from "node:crypto";

import type { ChatTurnWithMessageIds } from "./memory-turn-loader";
import type { MemorySourceBoundary } from "./memory-source-boundary";

function normalizeContent(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type CanonicalTurnFingerprintInput = {
  turnNumber: number;
  userMessageId: number | null;
  assistantMessageId: number | null;
  userContent: string;
  assistantContent: string;
};

export function canonicalTurnFingerprintInputsFromEligible(
  turns: readonly ChatTurnWithMessageIds[]
): CanonicalTurnFingerprintInput[] {
  return turns.map((turn) => ({
    turnNumber: turn.turnNumber,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
    userContent: normalizeContent(turn.user),
    assistantContent: normalizeContent(turn.assistant),
  }));
}

export function buildMemorySourceFingerprint(
  turns: readonly CanonicalTurnFingerprintInput[]
): string {
  const parts = turns.map((turn) =>
    [
      turn.turnNumber,
      turn.userMessageId ?? 0,
      turn.assistantMessageId ?? 0,
      normalizeContent(turn.userContent),
      normalizeContent(turn.assistantContent),
    ].join("\x1f")
  );
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function buildMemorySourceFingerprintFromEligible(
  turns: readonly ChatTurnWithMessageIds[]
): string {
  return buildMemorySourceFingerprint(canonicalTurnFingerprintInputsFromEligible(turns));
}

export function buildBatchSourceFingerprint(
  turns: readonly ChatTurnWithMessageIds[],
  batchStart: number,
  batchEnd: number
): string {
  const batch = turns.filter(
    (turn) => turn.turnNumber >= batchStart && turn.turnNumber <= batchEnd
  );
  return buildMemorySourceFingerprintFromEligible(batch);
}

export type MemorySourceFingerprintSnapshot = {
  fingerprint: string;
  boundaryEpoch: number;
  resetAfterMessageId: number | null;
};

export function snapshotMemorySourceFingerprint(
  turns: readonly ChatTurnWithMessageIds[],
  boundary: MemorySourceBoundary
): MemorySourceFingerprintSnapshot {
  return {
    fingerprint: buildMemorySourceFingerprintFromEligible(turns),
    boundaryEpoch: boundary.epoch,
    resetAfterMessageId: boundary.resetAfterMessageId,
  };
}

export function memorySourceFingerprintStillValid(
  snapshot: MemorySourceFingerprintSnapshot,
  currentTurns: readonly ChatTurnWithMessageIds[],
  currentBoundary: MemorySourceBoundary
): boolean {
  if (snapshot.boundaryEpoch !== currentBoundary.epoch) return false;
  if (snapshot.resetAfterMessageId !== currentBoundary.resetAfterMessageId) return false;
  return snapshot.fingerprint === buildMemorySourceFingerprintFromEligible(currentTurns);
}
