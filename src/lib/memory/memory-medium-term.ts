import { resolveRecentNarrativeContextLimit } from "@/lib/contextTrack";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import {
  isEmptyOocScope,
  lorebookTextFromScopes,
  scopesInjectedIntoPrompt,
} from "./memory-summary-scope";
import {
  listMemoryRecordsForChat,
  type MemoryRecordView,
} from "./memory-turn-summary";

export type MediumTermTurnRange = {
  turnStart: number;
  turnEnd: number;
};

export type MediumTermMemoryAssembly = {
  text: string;
  blockCount: number;
  chars: number;
  turnRanges: MediumTermTurnRange[];
};

function isMediumTermEligibleRecord(record: MemoryRecordView): boolean {
  if (record.inactive) return false;
  const text = lorebookTextFromScopes(record.scopes, { branchStatus: record.branchStatus });
  if (!text.trim()) {
    return (
      scopesInjectedIntoPrompt(record.summaryKind) &&
      !(record.summaryKind === "branch_canon" && record.branchStatus === "closed") &&
      !isEmptyOocScope(record.summaryKind) &&
      !!record.summary.trim() &&
      record.summaryKind !== "noncanon"
    );
  }
  return true;
}

/** Canonical medium-term source rows — same eligibility as Global rebuild. */
export function listMediumTermEligibleRecords(
  chatId: number,
  opts?: {
    excludeTurnStartGte?: number;
    excludeAssistantMessageId?: number | null;
  }
): MemoryRecordView[] {
  let records = listMemoryRecordsForChat(chatId).filter(isMediumTermEligibleRecord);
  const cutoff = opts?.excludeTurnStartGte;
  if (cutoff != null && cutoff > 0) {
    records = records.filter((record) => record.turnStart < cutoff);
  }
  if (opts?.excludeAssistantMessageId != null) {
    records = records.filter(
      (record) => record.assistantMessageId !== opts.excludeAssistantMessageId
    );
  }
  return records;
}

export function rawOwnedTurnStart(
  currentTurn: number,
  rawExchanges = RAW_HISTORY_COMPLETE_EXCHANGES
): number {
  return Math.max(1, currentTurn - rawExchanges + 1);
}

export function resolveMediumTermBlockCount(
  modelId?: string | null,
  provider?: "gemini" | "openrouter" | "openai"
): number {
  return resolveRecentNarrativeContextLimit(modelId, provider);
}

function formatMediumTermBlock(record: MemoryRecordView): string {
  const body =
    lorebookTextFromScopes(record.scopes, { branchStatus: record.branchStatus }) ||
    record.summary.trim();
  return `[최근 기억 · T${record.turnStart}–${record.turnEnd}]\n${body}`;
}

/**
 * Medium-term read-only projection from chat_turn_summaries.
 * Owns newest sealed blocks outside RAW — does not write or compact.
 */
export function buildMediumTermMemoryBlock(opts: {
  chatId: number;
  blockCount: number;
  excludeTurnStartGte?: number;
  excludeAssistantMessageId?: number | null;
}): MediumTermMemoryAssembly {
  const eligible = listMediumTermEligibleRecords(opts.chatId, {
    excludeTurnStartGte: opts.excludeTurnStartGte,
    excludeAssistantMessageId: opts.excludeAssistantMessageId,
  });
  if (eligible.length === 0 || opts.blockCount <= 0) {
    return { text: "", blockCount: 0, chars: 0, turnRanges: [] };
  }

  const ring = eligible.slice(-Math.min(opts.blockCount, eligible.length));
  const text = ring.map(formatMediumTermBlock).join("\n\n");
  return {
    text,
    blockCount: ring.length,
    chars: text.length,
    turnRanges: ring.map((record) => ({
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
    })),
  };
}

/** Literal duplicate chars when medium block bodies appear verbatim inside Global text. */
export function measureMediumGlobalLiteralDuplicateChars(
  mediumText: string,
  globalText: string
): number {
  if (!mediumText.trim() || !globalText.trim()) return 0;
  let duplicate = 0;
  for (const block of mediumText.split(/\n\n+/)) {
    const body = block.replace(/^\[최근 기억 · T\d+–\d+\]\n?/, "").trim();
    if (body && globalText.includes(body)) {
      duplicate += body.length;
    }
  }
  return duplicate;
}

/** Range overlap count — semantic overlap may remain justified under Design A. */
export function countMediumGlobalRangeOverlap(
  mediumRanges: readonly MediumTermTurnRange[],
  globalRanges: readonly MediumTermTurnRange[]
): number {
  let overlaps = 0;
  for (const medium of mediumRanges) {
    for (const global of globalRanges) {
      if (medium.turnStart <= global.turnEnd && medium.turnEnd >= global.turnStart) {
        overlaps += 1;
        break;
      }
    }
  }
  return overlaps;
}

export function sealedSummaryRangesThrough(summarizedThrough: number): MediumTermTurnRange[] {
  const ranges: MediumTermTurnRange[] = [];
  for (
    let start = 1;
    start + ROLLING_SUMMARY_INTERVAL - 1 <= summarizedThrough;
    start += ROLLING_SUMMARY_INTERVAL
  ) {
    ranges.push({ turnStart: start, turnEnd: start + ROLLING_SUMMARY_INTERVAL - 1 });
  }
  return ranges;
}
