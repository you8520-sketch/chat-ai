import { trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";

export type GlobalCurrentMemorySource = "chat_turn_summaries" | "chat_memories_recent_summary";

export type GlobalCurrentMemoryResolution = {
  text: string;
  overBudget: boolean;
  source: GlobalCurrentMemorySource;
  rebuiltChars: number;
  storedRecentSummaryChars: number;
};

/**
 * Single canonical Global Current Memory resolver for prompt + UI mirror.
 * Source records win when present; stored recent_summary is fallback only.
 */
export function resolveGlobalCurrentMemory(
  chatId: number,
  maxChars: number,
  opts?: { excludeTurnStartGte?: number; storedRecentSummary?: string }
): GlobalCurrentMemoryResolution {
  const rebuilt = rebuildLorebookFromRecords(chatId, opts).trim();
  const stored = opts?.storedRecentSummary?.trim() ?? "";
  const storedRecentSummaryChars = stored.length;
  const rebuiltChars = rebuilt.length;

  if (rebuilt) {
    if (rebuilt.length <= maxChars) {
      return {
        text: rebuilt,
        overBudget: false,
        source: "chat_turn_summaries",
        rebuiltChars,
        storedRecentSummaryChars,
      };
    }
    return {
      text: trimLorebookToBudgetSync(rebuilt, maxChars),
      overBudget: true,
      source: "chat_turn_summaries",
      rebuiltChars,
      storedRecentSummaryChars,
    };
  }

  if (!stored) {
    return {
      text: "",
      overBudget: false,
      source: "chat_memories_recent_summary",
      rebuiltChars: 0,
      storedRecentSummaryChars: 0,
    };
  }

  const overBudget = stored.length > maxChars;
  return {
    text: overBudget ? trimLorebookToBudgetSync(stored, maxChars) : stored,
    overBudget,
    source: "chat_memories_recent_summary",
    rebuiltChars: 0,
    storedRecentSummaryChars,
  };
}

/** 패널·프롬프트 조립 — LLM 대기 없이 기록 재조립 + 동기 trim */
export function resolveLorebookFromRecordsSync(
  chatId: number,
  maxChars: number,
  opts?: { excludeTurnStartGte?: number }
): { text: string; overBudget: boolean } {
  const resolved = resolveGlobalCurrentMemory(chatId, maxChars, opts);
  return { text: resolved.text, overBudget: resolved.overBudget };
}

/** DB 기록 재조립 + 동기 trim — prompt path와 동일 (LLM compact 없음) */
export async function resolveLorebookFromRecords(
  chatId: number,
  maxChars: number,
  _turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<{ text: string; compressed: boolean }> {
  const resolved = resolveGlobalCurrentMemory(chatId, maxChars);
  return { text: resolved.text, compressed: resolved.overBudget };
}
