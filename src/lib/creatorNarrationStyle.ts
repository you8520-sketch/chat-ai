import { speechCreatorCharCount, type SpeechCreatorInput } from "@/lib/speechCreatorFields";
import { buildSimulationSystemPrompt } from "@/lib/simulationMode";

/** Canonical creator narration/style note limit — single owner. */
export const NARRATION_STYLE_INSTRUCTIONS_LIMIT = 300;

export function normalizeNarrationStyleInstructions(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function validateNarrationStyleInstructions(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value);
  if (raw.length > NARRATION_STYLE_INSTRUCTIONS_LIMIT) {
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

export function substantiveAiLearningCharCount(input: {
  contentKind: "character" | "simulation";
  world: string;
  systemPrompt: string;
  simulationCast?: string;
  simulationRules?: string;
  simulationImportPromptChars?: number;
  speechInput: SpeechCreatorInput;
}): number {
  if (input.contentKind === "simulation") {
    const compiled =
      buildSimulationSystemPrompt({
        cast: input.simulationCast ?? input.systemPrompt,
        rules: input.simulationRules ?? "",
      }).length + (input.simulationImportPromptChars ?? 0);
    return input.world.length + compiled;
  }
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
