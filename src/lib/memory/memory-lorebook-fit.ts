import { compactCurrentMemory } from "./memory-rolling-summary";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { isMemoryFeatureEnabled } from "./memory-feature";

/** LLM 없이 프롬프트·UI용 — 구절 경계에서 잘라 상한 맞춤 */
export function trimLorebookToBudgetSync(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return clampMemoryRecordSummary(trimmed, maxChars, 0);
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
