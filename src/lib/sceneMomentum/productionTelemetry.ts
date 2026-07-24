import type { CanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { isDeepSeekV4ProModel } from "@/lib/chatModels";
import type { MomentumActivationObservability } from "@/lib/sceneMomentum/predicate";

/** Privacy-safe Scene Momentum telemetry for production DeepSeek D2 canary requests. */
export type SceneMomentumProductionTelemetry = {
  requestId: string | null;
  chatId: number;
  modelId: string;
  actualCanonMode: CanonInjectionPolicy["actualCanonMode"];
  actualArchiveMode: CanonInjectionPolicy["actualArchiveMode"];
  momentumActive: boolean;
  activationReason: MomentumActivationObservability["activationReason"];
  existingThinHistory: boolean;
  alternatingExchanges: number;
  structuralMature: boolean;
  fieldsPresent: string[];
  blockChars: number;
};

const ALLOWED_TELEMETRY_KEYS = [
  "requestId",
  "chatId",
  "modelId",
  "actualCanonMode",
  "actualArchiveMode",
  "momentumActive",
  "activationReason",
  "existingThinHistory",
  "alternatingExchanges",
  "structuralMature",
  "fieldsPresent",
  "blockChars",
] as const;

/** True only for actual DeepSeek V4 Pro D2 canary traffic (not general users/models). */
export function shouldLogSceneMomentumProductionTelemetry(opts: {
  modelId: string;
  canaryActualInjection: boolean;
}): boolean {
  return isDeepSeekV4ProModel(opts.modelId) && opts.canaryActualInjection === true;
}

/** Build the structured payload from the single source of truth: built.meta.momentumActivation. */
export function buildSceneMomentumProductionTelemetry(opts: {
  requestId: string | null;
  chatId: number;
  modelId: string;
  canonInjectionPolicy: Pick<
    CanonInjectionPolicy,
    "actualCanonMode" | "actualArchiveMode"
  >;
  momentumActivation: MomentumActivationObservability;
}): SceneMomentumProductionTelemetry {
  return {
    requestId: opts.requestId,
    chatId: opts.chatId,
    modelId: opts.modelId,
    actualCanonMode: opts.canonInjectionPolicy.actualCanonMode,
    actualArchiveMode: opts.canonInjectionPolicy.actualArchiveMode,
    momentumActive: opts.momentumActivation.momentumActive,
    activationReason: opts.momentumActivation.activationReason,
    existingThinHistory: opts.momentumActivation.existingThinHistory,
    alternatingExchanges: opts.momentumActivation.alternatingExchanges,
    structuralMature: opts.momentumActivation.structuralMature,
    fieldsPresent: [...opts.momentumActivation.fieldsPresent],
    blockChars: opts.momentumActivation.blockChars,
  };
}

/** Emit one structured server log line — no prompt/history/user text. */
export function logSceneMomentumProductionTelemetry(
  payload: SceneMomentumProductionTelemetry
): void {
  console.info("[scene-momentum]", payload);
}

/** Test helper — ensures telemetry stays metadata-only (no private text fields). */
export function assertSceneMomentumTelemetryPrivacySafe(
  payload: SceneMomentumProductionTelemetry
): void {
  const keys = Object.keys(payload).sort();
  const allowed = [...ALLOWED_TELEMETRY_KEYS].sort();
  if (keys.join(",") !== allowed.join(",")) {
    throw new Error(
      `unexpected telemetry keys: ${keys.join(", ")} (allowed: ${allowed.join(", ")})`
    );
  }
  for (const value of Object.values(payload)) {
    if (typeof value === "string" && value.length > 64) {
      throw new Error("telemetry string field exceeds safe metadata length");
    }
  }
}
