/**
 * PR-S4C — Per-speaker prompt isolation & ensemble safety gate.
 *
 * Invariant: a model call may receive observer-specific secret facts
 * only when the call has exactly one authoritative observer owner.
 *
 * Ambiguity -> ENSEMBLE_REDACTED (fail-closed). Never fall back to
 * "main character facts" for ensemble / multi-speaker / free-text cast.
 */

import type Database from "better-sqlite3";
import { getChatObserver } from "@/lib/observerIdentity";
import { mainCharacterObserverId } from "@/lib/observerTypes";
import type { PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";

export type PersonaKnowledgePromptMode =
  | "OBSERVER_SPECIFIC"
  | "ENSEMBLE_REDACTED";

export type PersonaKnowledgePromptReason =
  | "AUTHORITATIVE_SINGLE_SPEAKER"
  | "SIMULATION_ENSEMBLE"
  | "MULTIPLE_SPEAKERS_POSSIBLE"
  | "FREE_TEXT_CAST"
  | "MISSING_AUTHORITATIVE_SPEAKER"
  | "INVALID_OBSERVER"
  | "OBSERVER_NOT_IN_CHAT";

export type GenerationKnowledgeContext = {
  isSimulationEnsemble: boolean;
  mayGenerateMultipleSpeakers: boolean;
  usesFreeTextCast: boolean;
  authoritativeSpeaker?: {
    observerType: PersonaSecretObserverType;
    observerId: string;
  };
};

export type PersonaKnowledgePromptDecision = {
  mode: PersonaKnowledgePromptMode;
  observerType?: PersonaSecretObserverType;
  observerId?: string;
  reasonCode: PersonaKnowledgePromptReason;
};

/** Metadata safe for model-picker / prompt snapshots — no secret fact text. */
export type PersonaKnowledgePromptDecisionMeta = {
  personaKnowledgePromptMode: PersonaKnowledgePromptMode;
  reasonCode: PersonaKnowledgePromptReason;
  includedObserverFacts: boolean;
};

let ensembleRedactedAssemblyDepth = 0;

/**
 * While assembling an ENSEMBLE_REDACTED prompt, observer-specific knowledge
 * builders must not be queried. Accidental direct calls throw.
 */
export function withEnsembleRedactedPromptAssembly<T>(fn: () => T): T {
  ensembleRedactedAssemblyDepth += 1;
  try {
    return fn();
  } finally {
    ensembleRedactedAssemblyDepth -= 1;
  }
}

export function assertObserverSpecificKnowledgeQueryAllowed(): void {
  if (ensembleRedactedAssemblyDepth > 0) {
    throw new Error(
      "PERSONA_KNOWLEDGE_QUERY_FORBIDDEN_IN_ENSEMBLE_REDACTED_SCOPE"
    );
  }
}

export function isInsideEnsembleRedactedPromptAssembly(): boolean {
  return ensembleRedactedAssemblyDepth > 0;
}

/**
 * Fixed priority — do not reorder. Fail-closed on ambiguity.
 */
export function resolvePersonaKnowledgePromptPolicy(
  context: GenerationKnowledgeContext
): PersonaKnowledgePromptDecision {
  if (context.isSimulationEnsemble) {
    return {
      mode: "ENSEMBLE_REDACTED",
      reasonCode: "SIMULATION_ENSEMBLE",
    };
  }

  if (context.mayGenerateMultipleSpeakers) {
    return {
      mode: "ENSEMBLE_REDACTED",
      reasonCode: "MULTIPLE_SPEAKERS_POSSIBLE",
    };
  }

  if (context.usesFreeTextCast) {
    return {
      mode: "ENSEMBLE_REDACTED",
      reasonCode: "FREE_TEXT_CAST",
    };
  }

  if (!context.authoritativeSpeaker) {
    return {
      mode: "ENSEMBLE_REDACTED",
      reasonCode: "MISSING_AUTHORITATIVE_SPEAKER",
    };
  }

  return {
    mode: "OBSERVER_SPECIFIC",
    observerType: context.authoritativeSpeaker.observerType,
    observerId: context.authoritativeSpeaker.observerId,
    reasonCode: "AUTHORITATIVE_SINGLE_SPEAKER",
  };
}

/**
 * Build generation context from character/chat fields.
 * Never infers speaker from cast names, assistant output, or frequency.
 */
export function buildGenerationKnowledgeContext(opts: {
  contentKind?: string | null;
  simulationCast?: string | null;
  characterId: number;
}): GenerationKnowledgeContext {
  const isSimulation = opts.contentKind === "simulation";
  if (isSimulation) {
    return {
      isSimulationEnsemble: true,
      mayGenerateMultipleSpeakers: true,
      usesFreeTextCast: true,
    };
  }

  return {
    isSimulationEnsemble: false,
    mayGenerateMultipleSpeakers: false,
    usesFreeTextCast: false,
    authoritativeSpeaker: {
      observerType: "CHARACTER",
      observerId: mainCharacterObserverId(opts.characterId),
    },
  };
}

/**
 * Policy + chat observer registry validation (fail-closed).
 */
export function resolvePersonaKnowledgePromptDecisionForChat(
  context: GenerationKnowledgeContext,
  opts: { chatId: number; db?: Database.Database }
): PersonaKnowledgePromptDecision {
  const base = resolvePersonaKnowledgePromptPolicy(context);
  if (base.mode !== "OBSERVER_SPECIFIC") return base;

  const observerType = base.observerType;
  const observerId = base.observerId;
  if (
    !observerType ||
    !observerId ||
    (observerType !== "CHARACTER" &&
      observerType !== "NPC" &&
      observerType !== "PARTY_MEMBER")
  ) {
    return { mode: "ENSEMBLE_REDACTED", reasonCode: "INVALID_OBSERVER" };
  }

  const row = getChatObserver({
    chatId: opts.chatId,
    observerType,
    observerId,
    db: opts.db,
  });
  if (!row || row.is_active !== 1) {
    return { mode: "ENSEMBLE_REDACTED", reasonCode: "OBSERVER_NOT_IN_CHAT" };
  }

  return base;
}

export function personaKnowledgePromptDecisionMeta(
  decision: PersonaKnowledgePromptDecision
): PersonaKnowledgePromptDecisionMeta {
  return {
    personaKnowledgePromptMode: decision.mode,
    reasonCode: decision.reasonCode,
    includedObserverFacts: decision.mode === "OBSERVER_SPECIFIC",
  };
}