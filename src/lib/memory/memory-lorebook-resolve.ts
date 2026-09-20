import { getChatMemoryRow } from "./memory-db";
import { buildPrefixFingerprintThroughTurn } from "./memory-global-checkpoint";
import {
  emergencyFallbackTrimLorebookSync,
  isGlobalCompactProjectionFresh,
  isManualGlobalProjectionFresh,
} from "./memory-global-projection";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import type { GlobalProjectionKind } from "./memory-global-projection";

export type GlobalCurrentMemorySource = "chat_turn_summaries" | "chat_memories_recent_summary";

export type GlobalCurrentMemoryResolution = {
  text: string;
  overBudget: boolean;
  source: GlobalCurrentMemorySource;
  projectionKind: GlobalProjectionKind;
  rebuiltChars: number;
  storedRecentSummaryChars: number;
  needsBackgroundCompact: boolean;
};

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
  const rebuilt = rebuildLorebookFromRecords(chatId, opts).trim();
  const memoryRow = getChatMemoryRow(chatId);
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

  if (memoryRow?.global_projection_kind === "manual_global" && stored) {
    if (isManualGlobalProjectionFresh(chatId, rebuilt, stored, maxChars)) {
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
