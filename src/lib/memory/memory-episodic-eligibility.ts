/**
 * Per-turn episodic eligibility — consumes memory-summary-scope owner.
 * Shared by request gate, reconcile, and persistence (final authority).
 */
import type Database from "better-sqlite3";
import {
  resolveEpisodicTurnEligibility,
  resolvePreviousWasNoncanonOrBranchState,
  resolveSealedNoncanonOrBranchFromMemoryRecords,
  type EpisodicTurnEligibility,
} from "./memory-summary-scope";
import { loadMemoryEligibleChatTurnsWithMessageIdsCore } from "./memory-turn-loader";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

export type EpisodicEligibilityResolution = EpisodicTurnEligibility & {
  previousWasNoncanonOrBranch: boolean;
};

export function resolveEpisodicEligibilityForSourceUserMessage(
  db: Database.Database,
  opts: {
    chatId: number;
    sourceUserMessageId: number | null;
    sourceUserText: string;
  }
): EpisodicEligibilityResolution {
  const turns = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, opts.chatId);
  const currentIdx =
    opts.sourceUserMessageId != null
      ? turns.findIndex((t) => t.userMessageId === opts.sourceUserMessageId)
      : -1;
  const priorMessages =
    currentIdx > 0 ? turns.slice(0, currentIdx).map((t) => t.user) : [];
  const currentTurnNumber = currentIdx >= 0 ? turns[currentIdx]!.turnNumber : undefined;
  const memorySnapshots = listMemoryRecordsForChat(opts.chatId).map((r) => ({
    turnStart: r.turnStart,
    summaryKind: r.summaryKind,
    branchStatus: r.branchStatus,
    inactive: r.inactive,
  }));
  const sealedBranch = resolveSealedNoncanonOrBranchFromMemoryRecords(
    memorySnapshots,
    currentTurnNumber
  );
  const previousWasNoncanonOrBranch = resolvePreviousWasNoncanonOrBranchState(
    priorMessages,
    sealedBranch
  );
  const eligibility = resolveEpisodicTurnEligibility(opts.sourceUserText, {
    previousWasNoncanonOrBranch,
  });
  return { ...eligibility, previousWasNoncanonOrBranch };
}
