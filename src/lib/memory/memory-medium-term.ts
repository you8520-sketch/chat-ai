import type { GlobalProjectionKind } from "./memory-global-projection";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import {
  listPromptInjectibleMemoryRecords,
  loadTurnsForSummaryRoleReconciliation,
  reconcilePromptMemoryRecordBody,
  resolveManualGlobalMediumDelivery,
  resolvePromptInjectibleMemoryRecordBody,
  type MemoryRecordView,
} from "./memory-turn-summary";

/**
 * Canonical Medium-term horizon — 15 sealed 5-turn summary blocks (≈ recent 75 turns).
 * Model-neutral: all Main RP models use the same block count when Medium is active.
 */
export const MEDIUM_TERM_BLOCK_COUNT = 15;

export type MediumTermTurnRange = {
  turnStart: number;
  turnEnd: number;
  /** Set only when a manual Global covers the record's first turns — Medium delivers just the part after. */
  deliveredFromTurn?: number;
};

type MediumTermBlockSource = {
  record: MemoryRecordView;
  deliveredFromTurn: number;
  body: string;
};

export type MediumTermMemoryAssembly = {
  text: string;
  blockCount: number;
  chars: number;
  turnRanges: MediumTermTurnRange[];
};

const EMPTY_MEDIUM_TERM: MediumTermMemoryAssembly = {
  text: "",
  blockCount: 0,
  chars: 0,
  turnRanges: [],
};

/**
 * Canonical Medium-term activation owner.
 * Medium recovers chronological resolution lost by Global compaction — not duplicate exact rebuilds.
 * A user-saved Global covers history only up to its boundary; Medium carries the automatic records
 * sealed after it, so it is active for `manual_global` only when that boundary is known.
 */
export function shouldInjectMediumTermMemory(
  projectionKind: GlobalProjectionKind,
  manualBoundaryTurn?: number | null
): boolean {
  switch (projectionKind) {
    case "global_compact":
      return true;
    case "manual_global":
      return manualBoundaryTurn != null;
    case "exact":
    case "failure_fallback":
    case "stored_fallback":
      return false;
    default: {
      const _exhaustive: never = projectionKind;
      return _exhaustive;
    }
  }
}

export function rawOwnedTurnStart(
  currentTurn: number,
  rawExchanges = RAW_HISTORY_COMPLETE_EXCHANGES
): number {
  return Math.max(1, currentTurn - rawExchanges + 1);
}

function formatMediumTermBlock({ record, deliveredFromTurn, body }: MediumTermBlockSource): string {
  return `[최근 기억 · T${deliveredFromTurn}–${record.turnEnd}]\n${body}`;
}

function resolveMediumTermBlockSources(
  records: readonly MemoryRecordView[],
  manualBoundaryTurn: number | null
): MediumTermBlockSource[] {
  return records.flatMap((record): MediumTermBlockSource[] => {
    if (manualBoundaryTurn == null) {
      const body = resolvePromptInjectibleMemoryRecordBody(record);
      return [{ record, deliveredFromTurn: record.turnStart, body }];
    }
    const delivery = resolveManualGlobalMediumDelivery(record, manualBoundaryTurn);
    return delivery ? [{ record, ...delivery }] : [];
  });
}

function reconcileMediumTermSources(
  chatId: number,
  sources: readonly MediumTermBlockSource[]
): MediumTermBlockSource[] {
  const turns = loadTurnsForSummaryRoleReconciliation(
    chatId,
    sources.map((source) => source.body)
  );
  if (turns.length === 0) return [...sources];
  return sources.map((source) => {
    const body = reconcilePromptMemoryRecordBody(source.record, source.body, turns);
    return body === source.body ? source : { ...source, body };
  });
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
  /** Last completed turn a manual Global covers — Medium delivers only what comes after it. */
  manualBoundaryTurn?: number | null;
}): MediumTermMemoryAssembly {
  const eligible = reconcileMediumTermSources(
    opts.chatId,
    resolveMediumTermBlockSources(
      listPromptInjectibleMemoryRecords(opts.chatId, {
        excludeTurnStartGte: opts.excludeTurnStartGte,
        excludeAssistantMessageId: opts.excludeAssistantMessageId,
      }),
      opts.manualBoundaryTurn ?? null
    )
  );
  if (eligible.length === 0 || opts.blockCount <= 0) {
    return EMPTY_MEDIUM_TERM;
  }

  const ring = eligible.slice(-Math.min(opts.blockCount, eligible.length));
  const text = ring.map(formatMediumTermBlock).join("\n\n");
  return {
    text,
    blockCount: ring.length,
    chars: text.length,
    turnRanges: ring.map(({ record, deliveredFromTurn }) => ({
      turnStart: record.turnStart,
      turnEnd: record.turnEnd,
      ...(deliveredFromTurn > record.turnStart ? { deliveredFromTurn } : {}),
    })),
  };
}

/** Activation-gated assembly — single entry for memory-manager paths. */
export function buildMediumTermMemoryBlockForProjection(opts: {
  chatId: number;
  blockCount: number;
  excludeTurnStartGte?: number;
  excludeAssistantMessageId?: number | null;
  projectionKind: GlobalProjectionKind;
  manualBoundaryTurn?: number | null;
}): MediumTermMemoryAssembly {
  if (!shouldInjectMediumTermMemory(opts.projectionKind, opts.manualBoundaryTurn)) {
    return EMPTY_MEDIUM_TERM;
  }
  return buildMediumTermMemoryBlock({
    chatId: opts.chatId,
    blockCount: opts.blockCount,
    excludeTurnStartGte: opts.excludeTurnStartGte,
    excludeAssistantMessageId: opts.excludeAssistantMessageId,
    manualBoundaryTurn: opts.projectionKind === "manual_global" ? opts.manualBoundaryTurn : null,
  });
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
