import { speechCreatorCharCount, type SpeechCreatorInput } from "@/lib/speechCreatorFields";

/** Canonical creator narration/style note limit — single owner. */
export const NARRATION_STYLE_INSTRUCTIONS_LIMIT = 300;

export function normalizeNarrationStyleInstructions(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") return "";
  return value.trim();
}

export function validateNarrationStyleInstructions(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    return "서술·문체 지침은 문자열이어야 합니다.";
  }
  if (value.length > NARRATION_STYLE_INSTRUCTIONS_LIMIT) {
    return `서술·문체 지침은 ${NARRATION_STYLE_INSTRUCTIONS_LIMIT}자 이하여야 합니다.`;
  }
  return null;
}

/** Empty input yields empty output — no header, no token cost. */
export function buildCreatorNarrationStyleBlock(instructions: string): string {
  const normalized = normalizeNarrationStyleInstructions(instructions);
  if (!normalized) return "";
  return `[CREATOR NARRATION & STYLE NOTE — refinement only]
Platform prose, safety, agency, output language, and response-format rules above remain authoritative.
This note may refine POV presentation, narration density, sentence rhythm, descriptive tone, and dialogue/narration balance only — not canon facts, safety policy, or output structure.

${normalized}`;
}

/** Counts world + final compiled systemPrompt + speech (minimum and maximum base). */
export function substantiveAiLearningCharCount(input: {
  world: string;
  systemPrompt: string;
  speechInput: SpeechCreatorInput;
}): number {
  return (
    input.world.length +
    input.systemPrompt.length +
    speechCreatorCharCount(input.speechInput)
  );
}

/** Maximum authoring budget includes optional narration/style note. */
export function effectivePromptAuthoringCharCount(
  substantiveChars: number,
  narrationStyleInstructions: string
): number {
  return substantiveChars + normalizeNarrationStyleInstructions(narrationStyleInstructions).length;
}
