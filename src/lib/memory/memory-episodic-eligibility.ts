/**
 * Per-turn episodic eligibility — consumes memory-summary-scope owner.
 * Shared by request gate, reconcile, and persistence (final authority).
 */
import type Database from "better-sqlite3";
import {
  resolveEpisodicTurnEligibility,
  resolveSharedPreviousBranchState,
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
  const priorTurns =
    currentIdx > 0
      ? turns.slice(0, currentIdx).map((t) => ({ turnNumber: t.turnNumber, user: t.user }))
      : [];
  const currentTurnNumber = currentIdx >= 0 ? turns[currentIdx]!.turnNumber : undefined;
  const memorySnapshots = listMemoryRecordsForChat(opts.chatId).map((r) => ({
    turnStart: r.turnStart,
    turnEnd: r.turnEnd,
    summaryKind: r.summaryKind,
    branchStatus: r.branchStatus,
    inactive: r.inactive,
  }));
  const previousWasNoncanonOrBranch = resolveSharedPreviousBranchState({
    priorTurns,
    sealedRecords: memorySnapshots,
    beforeTurnNumber: currentTurnNumber,
  });
  const eligibility = resolveEpisodicTurnEligibility(opts.sourceUserText, {
    previousWasNoncanonOrBranch,
  });
  return { ...eligibility, previousWasNoncanonOrBranch };
}
