import { compactCurrentMemory } from "./memory-rolling-summary";
import { emergencyFallbackTrimLorebookSync } from "./memory-global-projection";
import { isGeminiIsolationMode } from "@/lib/geminiIsolationMode";
import { isMemoryFeatureEnabled } from "./memory-feature";

/** @deprecated Prefer emergencyFallbackTrimLorebookSync — kept for archive emergency trim call sites. */
export function trimLorebookToBudgetSync(text: string, maxChars: number): string {
  return emergencyFallbackTrimLorebookSync(text, maxChars);
}

/** Whole-history Global Summary compaction — LLM when enabled, emergency trim on failure. */
export async function ensureLorebookWithinBudget(
  text: string,
  maxChars: number,
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace
): Promise<{ text: string; compressed: boolean }> {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return { text: "", compressed: false };
  if (trimmed.length <= maxChars) return { text: trimmed, compressed: false };

  if (!isMemoryFeatureEnabled()) {
    return {
      text: emergencyFallbackTrimLorebookSync(trimmed, maxChars),
      compressed: trimmed.length > maxChars,
    };
  }

  if (isGeminiIsolationMode()) {
    console.warn("[gemini-isolation] lorebook compact skipped — emergency fallback trim");
    return {
      text: emergencyFallbackTrimLorebookSync(trimmed, maxChars),
      compressed: trimmed.length > maxChars,
    };
  }

  try {
    const compressed = await compactCurrentMemory(trimmed, maxChars, turnTrace);
    const out = compressed.trim();
    if (!out) {
      return {
        text: emergencyFallbackTrimLorebookSync(trimmed, maxChars),
        compressed: false,
      };
    }
    return { text: out, compressed: true };
  } catch (e) {
    console.warn("[memory] lorebook compact failed — emergency fallback trim:", (e as Error).message);
    return {
      text: emergencyFallbackTrimLorebookSync(trimmed, maxChars),
      compressed: false,
    };
  }
}
