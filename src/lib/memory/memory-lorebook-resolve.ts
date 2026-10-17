import { getChatMemoryRow } from "./memory-db";
import {
  buildPrefixFingerprintThroughTurn,
  isManualGlobalActive,
  readManualGlobalBoundary,
} from "./memory-global-checkpoint";
import {
  emergencyFallbackTrimLorebookSync,
  isGlobalCompactProjectionFresh,
  isManualGlobalProjectionFresh,
} from "./memory-global-projection";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import type { GlobalProjectionKind } from "./memory-global-projection";
import type { ChatMemoryRow } from "./memory-types";

export type GlobalCurrentMemorySource = "chat_turn_summaries" | "chat_memories_recent_summary";

export type GlobalCurrentMemoryResolution = {
  text: string;
  overBudget: boolean;
  source: GlobalCurrentMemorySource;
  projectionKind: GlobalProjectionKind;
  rebuiltChars: number;
  storedRecentSummaryChars: number;
  needsBackgroundCompact: boolean;
  /**
   * `manual_global` only: sealed-history turn the user's text covers. Medium carries the records after
   * it. `null` for every other projection (and for legacy manual rows until their next seal).
   */
  manualBoundaryTurn: number | null;
};

type GlobalCurrentMemoryCore = Omit<GlobalCurrentMemoryResolution, "manualBoundaryTurn">;

/**
 * Canonical Global Current Memory resolver.
 * Granular source: chat_turn_summaries.
 * Overflow Global projection: chat_memories.recent_summary when fresh whole-history compact.
 * Emergency fallback: prefer-recent mechanical trim (not healthy Global semantics).
 */
export function resolveGlobalCurrentMemory(
  chatId: number,
  maxChars: number,
  opts?: { excludeTurnStartGte?: number; storedRecentSummary?: string }
): GlobalCurrentMemoryResolution {
  const memoryRow = getChatMemoryRow(chatId);
  const resolved = resolveGlobalCurrentMemoryCore(chatId, maxChars, memoryRow, opts);
  return {
    ...resolved,
    manualBoundaryTurn:
      resolved.projectionKind === "manual_global" && memoryRow
        ? readManualGlobalBoundary(memoryRow)
        : null,
  };
}

function resolveGlobalCurrentMemoryCore(
  chatId: number,
  maxChars: number,
  memoryRow: ChatMemoryRow | null | undefined,
  opts?: { excludeTurnStartGte?: number; storedRecentSummary?: string }
): GlobalCurrentMemoryCore {
  const rebuilt = rebuildLorebookFromRecords(chatId, opts).trim();
  const stored = opts?.storedRecentSummary?.trim() ?? memoryRow?.recent_summary?.trim() ?? "";
  const storedRecentSummaryChars = stored.length;
  const rebuiltChars = rebuilt.length;

  if (!rebuilt) {
    const text =
      stored.length > maxChars ? emergencyFallbackTrimLorebookSync(stored, maxChars) : stored;
    return {
      text,
      overBudget: stored.length > maxChars,
      source: "chat_memories_recent_summary",
      projectionKind: stored ? "stored_fallback" : "exact",
      rebuiltChars: 0,
      storedRecentSummaryChars,
      needsBackgroundCompact: false,
    };
  }

  if (isManualGlobalActive(memoryRow) && stored) {
    if (isManualGlobalProjectionFresh(chatId, rebuilt, stored, maxChars, { explicitManualRow: true })) {
      return {
        text: stored,
        overBudget: rebuilt.length > maxChars,
        source: "chat_memories_recent_summary",
        projectionKind: "manual_global",
        rebuiltChars,
        storedRecentSummaryChars,
        needsBackgroundCompact: false,
      };
    }
  }

  if (rebuilt.length <= maxChars) {
    if (isManualGlobalProjectionFresh(chatId, rebuilt, stored, maxChars)) {
      return {
        text: stored,
        overBudget: false,
        source: "chat_memories_recent_summary",
        projectionKind: "manual_global",
        rebuiltChars,
        storedRecentSummaryChars,
        needsBackgroundCompact: false,
      };
    }
    return {
      text: rebuilt,
      overBudget: false,
      source: "chat_turn_summaries",
      projectionKind: "exact",
      rebuiltChars,
      storedRecentSummaryChars,
      needsBackgroundCompact: false,
    };
  }

  if (memoryRow?.global_projection_kind === "global_compact") {
    const durableValid =
      !!memoryRow.global_source_fingerprint &&
      memoryRow.global_covered_through_turn != null &&
      memoryRow.global_covered_through_turn > 0 &&
      buildPrefixFingerprintThroughTurn(chatId, memoryRow.global_covered_through_turn) ===
        memoryRow.global_source_fingerprint.trim() &&
      isGlobalCompactProjectionFresh(chatId, rebuilt, stored, maxChars);

    if (durableValid) {
      return {
        text: stored,
        overBudget: true,
        source: "chat_memories_recent_summary",
        projectionKind: "global_compact",
        rebuiltChars,
        storedRecentSummaryChars,
        needsBackgroundCompact: false,
      };
    }

    return {
      text: emergencyFallbackTrimLorebookSync(rebuilt, maxChars),
      overBudget: true,
      source: "chat_turn_summaries",
      projectionKind: "failure_fallback",
      rebuiltChars,
      storedRecentSummaryChars,
      needsBackgroundCompact: true,
    };
  }

  if (isGlobalCompactProjectionFresh(chatId, rebuilt, stored, maxChars)) {
    return {
      text: stored,
      overBudget: true,
      source: "chat_memories_recent_summary",
      projectionKind: "global_compact",
      rebuiltChars,
      storedRecentSummaryChars,
      needsBackgroundCompact: false,
    };
  }

  if (isManualGlobalProjectionFresh(chatId, rebuilt, stored, maxChars)) {
    return {
      text: stored,
      overBudget: true,
      source: "chat_memories_recent_summary",
      projectionKind: "manual_global",
      rebuiltChars,
      storedRecentSummaryChars,
      needsBackgroundCompact: false,
    };
  }

  return {
    text: emergencyFallbackTrimLorebookSync(rebuilt, maxChars),
    overBudget: true,
    source: "chat_turn_summaries",
    projectionKind: "failure_fallback",
    rebuiltChars,
    storedRecentSummaryChars,
    needsBackgroundCompact: true,
  };
}

/** 패널·프롬프트 조립 — 기록 재조립 + Global projection / emergency fallback */
export function resolveLorebookFromRecordsSync(
  chatId: number,
  maxChars: number,
  opts?: { excludeTurnStartGte?: number; storedRecentSummary?: string }
): { text: string; overBudget: boolean } {
  const resolved = resolveGlobalCurrentMemory(chatId, maxChars, opts);
  return { text: resolved.text, overBudget: resolved.overBudget };
}

/** Async resolve — mirrors sync path; background compact handled separately. */
export async function resolveLorebookFromRecords(
  chatId: number,
  maxChars: number,
  _turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<{ text: string; compressed: boolean }> {
  const memory = getChatMemoryRow(chatId);
  const resolved = resolveGlobalCurrentMemory(chatId, maxChars, {
    storedRecentSummary: memory?.recent_summary,
  });
  return {
    text: resolved.text,
    compressed: resolved.projectionKind === "global_compact" || resolved.projectionKind === "failure_fallback",
  };
}
