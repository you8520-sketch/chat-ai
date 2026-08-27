/**
 * S4 variant-scoped knowledge transfer coordination.
 * Test/internal seeding + variant-switch reconciliation (no live producer).
 */

import type Database from "better-sqlite3";
import { applyKnowledgeTransferAction } from "@/lib/knowledgeTransferApply";
import type {
  KnowledgeTransferApplyResult,
  KnowledgeTransferAuthoritativeAction,
  PersonaSecretTransferAction,
} from "@/lib/knowledgeTransferTypes";
import {
  currentActiveKnowledgeTransferGenerationSequence,
  isVariantScopedProvenance,
} from "@/lib/knowledgeTransferVariantProvenance";
import {
  hasVariantScopedS4EvidenceOnAssistant,
  syncVariantScopedS4ActivationsForAssistantMessage,
  type ObserverSecretProjectionKey,
} from "@/lib/personaSecretEvidenceActivation";
import { reprojectObserverSecretKnowledge } from "@/lib/personaSecretKnowledgeReprojection";
import type { PersonaSecretObserverType } from "@/lib/personaSecretDiscoveryTypes";

export class S4HistoricalVariantReplayUnsupportedError extends Error {
  readonly code = "s4_historical_variant_replay_unsupported";

  constructor(message = "s4_historical_variant_replay_unsupported") {
    super(message);
    this.name = "S4HistoricalVariantReplayUnsupportedError";
  }
}

export class S4VariantProvenanceInvalidError extends Error {
  readonly code = "s4_variant_provenance_invalid";

  constructor(message = "s4_variant_provenance_invalid") {
    super(message);
    this.name = "S4VariantProvenanceInvalidError";
  }
}

export {
  currentActiveKnowledgeTransferGenerationSequence,
  isVariantScopedProvenance,
  resolveKnowledgeTransferVariantProvenance,
} from "@/lib/knowledgeTransferVariantProvenance";
export type {
  KnowledgeTransferVariantProvenanceScope,
  ResolveKnowledgeTransferVariantProvenanceResult,
} from "@/lib/knowledgeTransferVariantProvenance";

/**
 * Production + test variant-scoped authoritative transfer apply.
 * Delegates to applyKnowledgeTransferAction (no direct SQL).
 */
export function applyVariantScopedAuthoritativeKnowledgeTransfer(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceAssistantMessageId: number;
  sourceGenerationSequence: number;
  action: Omit<
    PersonaSecretTransferAction,
    "sourceAssistantMessageId" | "sourceGenerationSequence" | "actionId"
  >;
  userMessageId?: number | null;
  db?: Database.Database;
}): KnowledgeTransferApplyResult {
  return seedVariantScopedKnowledgeTransfer(opts);
}

/**
 * @deprecated Prefer applyVariantScopedAuthoritativeKnowledgeTransfer — same behavior.
 * Internal/test seed name retained for existing tests.
 */
export function seedVariantScopedKnowledgeTransfer(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceAssistantMessageId: number;
  sourceGenerationSequence: number;
  action: Omit<
    PersonaSecretTransferAction,
    "sourceAssistantMessageId" | "sourceGenerationSequence" | "actionId"
  >;
  userMessageId?: number | null;
  db?: Database.Database;
}): KnowledgeTransferApplyResult {
  const action: KnowledgeTransferAuthoritativeAction = {
    ...opts.action,
    sourceAssistantMessageId: opts.sourceAssistantMessageId,
    sourceGenerationSequence: opts.sourceGenerationSequence,
    sourceMessageId: opts.userMessageId ?? undefined,
    actionId: `gen:${opts.sourceAssistantMessageId}:${opts.sourceGenerationSequence}`,
    sourceType: "SERVER_STRUCTURED_TRANSFER",
  };
  return applyKnowledgeTransferAction({
    chatId: opts.chatId,
    personaId: opts.personaId,
    characterId: opts.characterId,
    turnNumber: opts.turnNumber,
    sourceType: "SERVER_STRUCTURED_TRANSFER",
    action,
    db: opts.db,
  });
}

export function assertS4VariantSwitchAllowed(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number,
  hasLaterCanonicalTurn: boolean
): void {
  if (
    hasLaterCanonicalTurn &&
    hasVariantScopedS4EvidenceOnAssistant(db, chatId, assistantMessageId)
  ) {
    throw new S4HistoricalVariantReplayUnsupportedError();
  }
}

function reprojectAffectedKeys(
  db: Database.Database,
  chatId: number,
  keys: ObserverSecretProjectionKey[]
): void {
  for (const key of keys) {
    reprojectObserverSecretKnowledge({
      chatId,
      personaId: key.personaId,
      secretId: key.secretId,
      observerType: key.observerType as PersonaSecretObserverType,
      observerId: key.observerId,
      db,
    });
  }
}

/**
 * Variant-switch S4 reconciliation — call inside existing variant txn owner,
 * after messages.active_variant has been updated. Resolves active generation via
 * currentActiveKnowledgeTransferGenerationSequence (never index fallback).
 */
export function reconcileS4KnowledgeForVariantSwitch(
  db: Database.Database,
  input: {
    chatId: number;
    assistantMessageId: number;
    __testThrowAfterActivation?: boolean;
    __testThrowAfterReprojection?: boolean;
  }
): { affectedKeys: ObserverSecretProjectionKey[] } {
  if (!hasVariantScopedS4EvidenceOnAssistant(db, input.chatId, input.assistantMessageId)) {
    return { affectedKeys: [] };
  }

  const activeGenerationSequence = currentActiveKnowledgeTransferGenerationSequence(
    db,
    input.chatId,
    input.assistantMessageId
  );
  if (activeGenerationSequence == null) {
    throw new S4VariantProvenanceInvalidError();
  }

  const affectedKeys = syncVariantScopedS4ActivationsForAssistantMessage(db, {
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    activeGenerationSequence,
  });

  if (input.__testThrowAfterActivation) {
    throw new Error("TEST_THROW_AFTER_S4_ACTIVATION");
  }

  reprojectAffectedKeys(db, input.chatId, affectedKeys);

  if (input.__testThrowAfterReprojection) {
    throw new Error("TEST_THROW_AFTER_S4_REPROJECTION");
  }

  return { affectedKeys };
}

/** After variant-scoped apply, align activations and reproject receiver. */
export function finalizeVariantScopedTransferActivation(
  db: Database.Database,
  input: {
    chatId: number;
    assistantMessageId: number;
    receiver: { observerType: PersonaSecretObserverType; observerId: string };
    personaId: number;
    secretId: string;
  }
): void {
  const activeGenerationSequence = currentActiveKnowledgeTransferGenerationSequence(
    db,
    input.chatId,
    input.assistantMessageId
  );
  if (activeGenerationSequence != null) {
    syncVariantScopedS4ActivationsForAssistantMessage(db, {
      chatId: input.chatId,
      assistantMessageId: input.assistantMessageId,
      activeGenerationSequence,
    });
  }
  reprojectObserverSecretKnowledge({
    chatId: input.chatId,
    personaId: input.personaId,
    secretId: input.secretId,
    observerType: input.receiver.observerType,
    observerId: input.receiver.observerId,
    db,
  });
}
