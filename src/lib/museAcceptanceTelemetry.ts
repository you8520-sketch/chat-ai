/**
 * Muse acceptance telemetry — local classification only.
 * Does NOT trigger recovery/continuation/regenerate API calls.
 * Floor numbers (1800/900) are telemetry thresholds only — never injected into prompts.
 *
 * classificationScope is "length_and_local_output_health":
 * - acceptanceClass is NOT a style quality score
 * - Does NOT judge hard invention / voice / re-explanation / satisfaction
 * - ownership telemetry is a separate risk signal only
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
import type { Usage } from "@/lib/chatUsage";

/** Telemetry-only floors — not prompt / billing constants. */
export const MUSE_ACCEPTANCE_NORMAL_FLOOR_CHARS = 1800;
export const MUSE_ACCEPTANCE_SHORT_FLOOR_CHARS = 900;

/** Explicit scope — length + local output health only (not style quality). */
export const MUSE_ACCEPTANCE_CLASSIFICATION_SCOPE =
  "length_and_local_output_health" as const;

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
  /** Separate risk signal — not part of acceptanceClass quality judgment. */
  ownership?: MuseOwnershipTelemetry;
  completedTurns: number;
  characterId: number;
  personaId: number | null;
  modelId: string;
  selectedAI?: string | null;
  requestLatencyMs: number | null;
  cost: number | null;
  isRegenerationRequest: boolean;
  /** This request used isContinue (manual/auto continue of prior assistant). */
  isContinueRequest: boolean;
  apiCallCount?: number | null;
};

export type MuseAcceptanceTelemetry = {
  event: "muse_acceptance";
  /** length + local output health only — NOT a style quality score. */
  classificationScope: typeof MUSE_ACCEPTANCE_CLASSIFICATION_SCOPE;
  acceptanceClass: MuseAcceptanceClass;
  visibleChars: number;
  finishReason: string | null;
  completeSentence: boolean;
  healthyKorean: boolean;
  degeneration: boolean;
  degenerationReason: string | null;
  truncatedIncomplete: boolean;
  /** Separate risk signal — not folded into acceptanceClass. */
  ownership: MuseOwnershipTelemetry;
  completedTurns: number;
  characterId: number;
  personaId: number | null;
  modelId: string;
  selectedAI: string | null;
  requestLatencyMs: number | null;
  cost: number | null;
  isRegenerationRequest: boolean;
  isContinueRequest: boolean;
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

/**
 * Classify Muse output for local telemetry.
 * Judges: visible length, complete sentence, healthy Korean, truncation, degeneration.
 * Does NOT judge: hard invention, voice, re-explanation, satisfaction, or style quality.
 */
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
    classificationScope: MUSE_ACCEPTANCE_CLASSIFICATION_SCOPE,
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
    requestLatencyMs: input.requestLatencyMs,
    cost: input.cost,
    isRegenerationRequest: input.isRegenerationRequest,
    isContinueRequest: input.isContinueRequest,
    apiCallCount: input.apiCallCount ?? 1,
    autoContinuationTriggered: false,
  };
}

/** Compact payload for messages.usage / context_json (no prose text). Never send to clients. */
export function toMuseAcceptanceUsageFields(
  t: MuseAcceptanceTelemetry
): Record<string, unknown> {
  return {
    classificationScope: t.classificationScope,
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
    requestLatencyMs: t.requestLatencyMs,
    cost: t.cost,
    isRegenerationRequest: t.isRegenerationRequest,
    isContinueRequest: t.isContinueRequest,
    apiCallCount: t.apiCallCount,
    autoContinuationTriggered: t.autoContinuationTriggered,
  };
}

/** Strip internal Muse telemetry from any Usage object destined for clients. */
export function stripMuseAcceptanceFromUsage(usage: Usage): Usage {
  if (!usage || usage.museAcceptance == null) return usage;
  const { museAcceptance: _museAcceptance, ...rest } = usage;
  return rest;
}

export function logMuseAcceptanceTelemetry(t: MuseAcceptanceTelemetry): void {
  console.info("[muse-acceptance]", toMuseAcceptanceUsageFields(t));
}

export function shouldRecordMuseAcceptanceTelemetry(
  modelId?: string | null
): boolean {
  return isMuseSparkModel(modelId);
}
