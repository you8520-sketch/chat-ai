import { isDeepSeekModelId, resolveContextTrack } from "@/lib/contextTrack";
import type { GlobalProjectionKind } from "./memory-global-projection";
import { RAW_HISTORY_COMPLETE_EXCHANGES, ROLLING_SUMMARY_INTERVAL } from "./memory-constants";
import {
  listPromptInjectibleMemoryRecords,
  resolvePromptInjectibleMemoryRecordBody,
  type MemoryRecordView,
} from "./memory-turn-summary";

/**
 * Medium-term ring block counts — PROVISIONAL policy candidates.
 * Horizon semantics are model-neutral; values originated from dormant context-track limits.
 * GPT/user selects final N after full-prompt budget evidence — do not treat as proven policy.
 */
export const MEDIUM_TERM_BLOCK_COUNT_GEMINI = 15;
export const MEDIUM_TERM_BLOCK_COUNT_DEEPSEEK = 10;
export const MEDIUM_TERM_BLOCK_COUNT_CLAUDE = 5;

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

const EMPTY_MEDIUM_TERM: MediumTermMemoryAssembly = {
  text: "",
  blockCount: 0,
  chars: 0,
  turnRanges: [],
};

/**
 * Canonical Medium-term activation owner.
 * Medium recovers chronological resolution lost by Global compaction — not duplicate exact rebuilds.
 */
export function shouldInjectMediumTermMemory(projectionKind: GlobalProjectionKind): boolean {
  switch (projectionKind) {
    case "global_compact":
      return true;
    case "exact":
    case "failure_fallback":
    case "stored_fallback":
    case "manual_global":
      return false;
    default: {
      const _exhaustive: never = projectionKind;
      return _exhaustive;
    }
  }
}

/** @deprecated use listPromptInjectibleMemoryRecords — alias for Medium parity tests. */
export function listMediumTermEligibleRecords(
  chatId: number,
  opts?: {
    excludeTurnStartGte?: number;
    excludeAssistantMessageId?: number | null;
  }
): MemoryRecordView[] {
  return listPromptInjectibleMemoryRecords(chatId, opts);
}

export function rawOwnedTurnStart(
  currentTurn: number,
  rawExchanges = RAW_HISTORY_COMPLETE_EXCHANGES
): number {
  return Math.max(1, currentTurn - rawExchanges + 1);
}

/** Provider adapter — applies provisional block-count candidates per model family. */
export function resolveMediumTermBlockCount(
  modelId?: string | null,
  provider?: "gemini" | "openrouter" | "openai"
): number {
  if (isDeepSeekModelId(modelId ?? "")) return MEDIUM_TERM_BLOCK_COUNT_DEEPSEEK;
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? MEDIUM_TERM_BLOCK_COUNT_GEMINI
    : MEDIUM_TERM_BLOCK_COUNT_CLAUDE;
}

function formatMediumTermBlock(record: MemoryRecordView): string {
  const body = resolvePromptInjectibleMemoryRecordBody(record);
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
  const eligible = listPromptInjectibleMemoryRecords(opts.chatId, {
    excludeTurnStartGte: opts.excludeTurnStartGte,
    excludeAssistantMessageId: opts.excludeAssistantMessageId,
  });
  if (eligible.length === 0 || opts.blockCount <= 0) {
    return EMPTY_MEDIUM_TERM;
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

/** Activation-gated assembly — single entry for memory-manager paths. */
export function buildMediumTermMemoryBlockForProjection(opts: {
  chatId: number;
  blockCount: number;
  excludeTurnStartGte?: number;
  excludeAssistantMessageId?: number | null;
  projectionKind: GlobalProjectionKind;
}): MediumTermMemoryAssembly {
  if (!shouldInjectMediumTermMemory(opts.projectionKind)) {
    return EMPTY_MEDIUM_TERM;
  }
  return buildMediumTermMemoryBlock(opts);
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
