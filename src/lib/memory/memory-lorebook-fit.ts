import { compactCurrentMemory } from "./memory-rolling-summary";
import { clampLorebookPreferRecentChars } from "./memory-lorebook-trim";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { isMemoryFeatureEnabled } from "./memory-feature";

/** LLM 없이 프롬프트·UI용 — 최신 블록 우선, 비어 있지 않게 유지 */
export function trimLorebookToBudgetSync(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const { text: fitted } = clampLorebookPreferRecentChars(trimmed, maxChars);
  if (fitted.trim()) return fitted;
  return trimmed.slice(0, maxChars).trimEnd() || trimmed.slice(0, maxChars);
}

/** 용량 초과 시 블록 삭제 대신 Flash로 전체 재압축 */
export async function ensureLorebookWithinBudget(
  text: string,
  maxChars: number,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<{ text: string; compressed: boolean }> {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return { text: "", compressed: false };
  if (trimmed.length <= maxChars) return { text: trimmed, compressed: false };

  if (!isMemoryFeatureEnabled()) {
    return { text: trimmed.slice(0, maxChars), compressed: trimmed.length > maxChars };
  }

  if (isGeminiIsolationMode()) {
    console.warn("[gemini-isolation] lorebook compact skipped — truncating to budget");
    return { text: trimmed.slice(0, maxChars), compressed: trimmed.length > maxChars };
  }

  try {
    const compressed = await compactCurrentMemory(trimmed, maxChars, turnTrace);
    const out = compressed.trim();
    if (!out) return { text: trimmed, compressed: false };
    return { text: out, compressed: true };
  } catch (e) {
    console.warn("[memory] lorebook compact failed — keeping prior text:", (e as Error).message);
    return { text: trimmed, compressed: false };
  }
}
