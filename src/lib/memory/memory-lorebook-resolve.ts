import { ensureLorebookWithinBudget, trimLorebookToBudgetSync } from "./memory-lorebook-fit";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";

/** 패널·프롬프트 조립 — LLM 대기 없이 기록 재조립 + 동기 trim */
export function resolveLorebookFromRecordsSync(
  chatId: number,
  maxChars: number,
  opts?: { excludeTurnStartGte?: number }
): { text: string; overBudget: boolean } {
  const rebuilt = rebuildLorebookFromRecords(chatId, opts).trim();
  if (!rebuilt) return { text: "", overBudget: false };
  if (rebuilt.length <= maxChars) return { text: rebuilt, overBudget: false };
  return { text: trimLorebookToBudgetSync(rebuilt, maxChars), overBudget: true };
}

/** DB 기록을 시간순으로 이어 붙이고, 설정 상한 초과 시에만 압축 */
export async function resolveLorebookFromRecords(
  chatId: number,
  maxChars: number,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<{ text: string; compressed: boolean }> {
  const rebuilt = rebuildLorebookFromRecords(chatId).trim();
  if (!rebuilt) return { text: "", compressed: false };
  return ensureLorebookWithinBudget(rebuilt, maxChars, turnTrace);
}
