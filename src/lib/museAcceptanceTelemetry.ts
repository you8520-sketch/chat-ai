/**
 * Muse acceptance telemetry — local classification only.
 * Does NOT trigger recovery/continuation/regenerate API calls.
 * Floor numbers (1800/900) are telemetry thresholds only — never injected into prompts.
 */

import {
  visibleAssistantDisplayCharCount,
  visibleAssistantDisplayText,
} from "@/lib/chatDisplayLength";
import {
  getDegenerationReason,
  hasUnexpectedForeignScriptLeak,
  isDegenerateOutput,
  isHealthyKoreanNarrative,
} from "@/lib/gibberishGuard";
import { isMuseSparkModel } from "@/lib/proseMuseM1Policy";
import { endsAtCompleteSentence } from "@/lib/responseLength";

/** Telemetry-only floors — not prompt / billing constants. */
export const MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS = 1800;
export const MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS = 900;

export type MuseAcceptanceClass =
  | "NORMAL_PASS"
  | "SHORT_QUALITY_PASS"
  | "FAIL";

export type MuseOwnershipTelemetry = {
  hardCount: number;
  softCount: number;
  categoryBitmask: number;
  confidenceBucket: string;
  processingMs: number;
} | null;

export type MuseAcceptanceClassifyInput = {
  text: string;
  finishReason?: string | null;
  ownership?: MuseOwnershipTelemetry;
  completedTurns: number;
  characterId: number;
  personaId: number | null;
  modelId: string;
  selectedAI?: string | null;
  latencyMs: number | null;
  cost: number | null;
  userRegenerate: boolean;
  /** This request used isContinue (manual/auto continue of prior assistant). */
  manualContinueRequest: boolean;
  apiCallCount?: number | null;
};

export type MuseAcceptanceTelemetry = {
  event: "muse_acceptance";
  acceptanceClass: MuseAcceptanceClass;
  visibleChars: number;
  finishReason: string | null;
  completeSentence: boolean;
  healthyKorean: boolean;
  degeneration: boolean;
  degenerationReason: string | null;
  truncatedIncomplete: boolean;
  ownership: MuseOwnershipTelemetry;
  completedTurns: number;
  characterId: number;
  personaId: number | null;
  modelId: string;
  selectedAI: string | null;
  latencyMs: number | null;
  cost: number | null;
  userRegenerate: boolean;
  manualContinueRequest: boolean;
  apiCallCount: number;
  /** Always false under current 1-pass policy — documented for analytics. */
  autoContinuationTriggered: false;
};

function normalizeFinishReason(finishReason?: string | null): string {
  return String(finishReason ?? "").trim().toUpperCase();
}

function isTruncationFinish(finish: string): boolean {
  return (
    finish === "LENGTH" ||
    finish === "MAX_TOKENS" ||
    finish === "MAX_TOKEN" ||
    finish.includes("LENGTH")
  );
}

function isLoopOrDegenerationFinish(finish: string): boolean {
  return (
    finish === "LOOP_ABORT" ||
    finish === "DEGENERATION_ABORT" ||
    finish === "STREAM_LENGTH_CAP"
  );
}

export function classifyMuseAcceptance(
  input: MuseAcceptanceClassifyInput
): MuseAcceptanceTelemetry {
  const prose = visibleAssistantDisplayText(input.text ?? "");
  const visibleChars = visibleAssistantDisplayCharCount(input.text ?? "");
  const finishReason = input.finishReason ? String(input.finishReason) : null;
  const finish = normalizeFinishReason(finishReason);
  const completeSentence = visibleChars > 0 && endsAtCompleteSentence(prose);
  const healthyKorean = visibleChars > 0 && isHealthyKoreanNarrative(prose);
  const foreignLeak = visibleChars > 0 && hasUnexpectedForeignScriptLeak(prose);
  const degeneration =
    isLoopOrDegenerationFinish(finish) ||
    (visibleChars > 0 && isDegenerateOutput(prose)) ||
    foreignLeak;
  const degenerationReason = degeneration
    ? foreignLeak
      ? "foreign_script_leak"
      : getDegenerationReason(prose) || finish || "degeneration"
    : null;
  const truncatedIncomplete =
    isTruncationFinish(finish) && (!completeSentence || visibleChars === 0);
  const empty = visibleChars === 0;

  let acceptanceClass: MuseAcceptanceClass = "FAIL";
  if (
    !empty &&
    !degeneration &&
    !truncatedIncomplete &&
    completeSentence &&
    healthyKorean
  ) {
    if (visibleChars >= MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS) {
      acceptanceClass = "NORMAL_PASS";
    } else if (visibleChars >= MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS) {
      acceptanceClass = "SHORT_QUALITY_PASS";
    }
  }

  return {
    event: "muse_acceptance",
    acceptanceClass,
    visibleChars,
    finishReason,
    completeSentence,
    healthyKorean,
    degeneration,
    degenerationReason,
    truncatedIncomplete,
    ownership: input.ownership ?? null,
    completedTurns: input.completedTurns,
    characterId: input.characterId,
    personaId: input.personaId,
    modelId: input.modelId,
    selectedAI: input.selectedAI ?? null,
    latencyMs: input.latencyMs,
    cost: input.cost,
    userRegenerate: input.userRegenerate,
    manualContinueRequest: input.manualContinueRequest,
    apiCallCount: input.apiCallCount ?? 1,
    autoContinuationTriggered: false,
  };
}

/** Compact payload for messages.usage / context_json (no prose text). */
export function toMuseAcceptanceUsageFields(
  t: MuseAcceptanceTelemetry
): Record<string, unknown> {
  return {
    acceptanceClass: t.acceptanceClass,
    visibleChars: t.visibleChars,
    finishReason: t.finishReason,
    completeSentence: t.completeSentence,
    healthyKorean: t.healthyKorean,
    degeneration: t.degeneration,
    degenerationReason: t.degenerationReason,
    truncatedIncomplete: t.truncatedIncomplete,
    ownership: t.ownership,
    completedTurns: t.completedTurns,
    characterId: t.characterId,
    personaId: t.personaId,
    modelId: t.modelId,
    selectedAI: t.selectedAI,
    latencyMs: t.latencyMs,
    cost: t.cost,
    userRegenerate: t.userRegenerate,
    manualContinueRequest: t.manualContinueRequest,
    apiCallCount: t.apiCallCount,
    autoContinuationTriggered: t.autoContinuationTriggered,
  };
}

export function logMuseAcceptanceTelemetry(t: MuseAcceptanceTelemetry): void {
  console.info("[muse-acceptance]", toMuseAcceptanceUsageFields(t));
}

export function shouldRecordMuseAcceptanceTelemetry(
  modelId?: string | null
): boolean {
  return isMuseSparkModel(modelId);
}
