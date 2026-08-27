/**
 * PR-S4D — Validate and apply controlled knowledge transfers.
 * Sender cannot transfer knowledge the sender does not possess.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureKnowledgeTransferSchema } from "@/lib/knowledgeTransferSchema";
import {
  KNOWLEDGE_TRANSFER_MATCHER_VERSION,
  type KnowledgeTransferApplyResult,
  type KnowledgeTransferSource,
  type KnowledgeTransferType,
  type PersonaSecretTransferAction,
} from "@/lib/knowledgeTransferTypes";
import { getChatObserver } from "@/lib/observerIdentity";
import type { PersonaSecretKnowledgeState } from "@/lib/personaSecretDiscoveryTypes";
import {
  finalizeVariantScopedTransferActivation,
  isVariantScopedProvenance,
  resolveKnowledgeTransferVariantProvenance,
} from "@/lib/knowledgeTransferVariant";
import { insertVariantScopedEvidenceActivation } from "@/lib/personaSecretEvidenceActivation";
import { reprojectObserverSecretKnowledge } from "@/lib/personaSecretKnowledgeReprojection";
import { getObserverSecretKnowledge } from "@/lib/personaSecretKnowledge";
import { getPersonaSecretById } from "@/lib/personaSecrets";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";
import {
  canObserveAuditorily,
  canObserveVisually,
  getActiveScenePresenceForObserver,
} from "@/lib/scenePresence";

const ALLOWED_SOURCES = new Set<KnowledgeTransferSource>([
  "USER_EXPLICIT_TRANSFER",
  "SERVER_STRUCTURED_TRANSFER",
  "CREATOR_STRUCTURED_TRANSFER",
]);

export function resolveKnowledgeTransferActionRef(opts: {
  sourceMessageId?: number | null;
  sourceAssistantMessageId?: number | null;
  sourceGenerationSequence?: number | null;
  actionId?: string | null;
  authoritativeEventId?: string | null;
}): string | null {
  if (
    opts.sourceAssistantMessageId != null &&
    Number.isFinite(opts.sourceAssistantMessageId) &&
    opts.sourceGenerationSequence != null &&
    Number.isInteger(opts.sourceGenerationSequence) &&
    opts.sourceGenerationSequence >= 0
  ) {
    return `asst:${Math.floor(opts.sourceAssistantMessageId)}:g${opts.sourceGenerationSequence}`;
  }
  if (opts.sourceMessageId != null && Number.isFinite(opts.sourceMessageId)) {
    return String(Math.floor(opts.sourceMessageId));
  }
  const actionId = opts.actionId?.trim() || opts.authoritativeEventId?.trim();
  return actionId ? actionId : null;
}

export function buildKnowledgeTransferIdempotencyKey(opts: {
  chatId: number;
  secretId: string;
  senderType: string;
  senderId: string;
  receiverType: string;
  receiverId: string;
  sourceMessageId?: number | null;
  sourceAssistantMessageId?: number | null;
  sourceGenerationSequence?: number | null;
  actionId?: string | null;
  authoritativeEventId?: string | null;
  transferType: KnowledgeTransferType;
  version?: number;
}): string | null {
  const actionRef = resolveKnowledgeTransferActionRef(opts);
  if (!actionRef) return null;
  return [
    "knowledge-transfer",
    opts.chatId,
    opts.secretId,
    opts.senderType,
    opts.senderId,
    opts.receiverType,
    opts.receiverId,
    actionRef,
    opts.transferType,
    opts.version ?? KNOWLEDGE_TRANSFER_MATCHER_VERSION,
  ].join(":");
}

function validateSceneChannel(
  transferType: KnowledgeTransferType,
  chatId: number,
  senderType: PersonaSecretTransferAction["sender"]["observerType"],
  senderId: string,
  receiverType: PersonaSecretTransferAction["receiver"]["observerType"],
  receiverId: string,
  db: Database.Database
): KnowledgeTransferApplyResult | null {
  if (transferType === "SERVER_DISCLOSURE") return null;

  const senderPresence = getActiveScenePresenceForObserver({
    chatId,
    observerType: senderType,
    observerId: senderId,
    db,
  });
  const receiverPresence = getActiveScenePresenceForObserver({
    chatId,
    observerType: receiverType,
    observerId: receiverId,
    db,
  });

  if (transferType === "DIRECT_STATEMENT") {
    if (
      !senderPresence ||
      senderPresence.presence_state !== "PRESENT" ||
      senderPresence.awareness_state !== "AWARE"
    ) {
      return { ok: false, reason: "PRESENCE_BLOCKED" };
    }
    if (
      !receiverPresence ||
      receiverPresence.presence_state !== "PRESENT" ||
      receiverPresence.awareness_state !== "AWARE"
    ) {
      return { ok: false, reason: "PRESENCE_BLOCKED" };
    }
    if (!canObserveAuditorily(receiverPresence)) {
      return { ok: false, reason: "CAPABILITY_BLOCKED" };
    }
    return null;
  }

  // DOCUMENT_HANDOFF
  if (!senderPresence || senderPresence.presence_state !== "PRESENT") {
    return { ok: false, reason: "PRESENCE_BLOCKED" };
  }
  if (
    !receiverPresence ||
    receiverPresence.presence_state !== "PRESENT" ||
    receiverPresence.awareness_state !== "AWARE"
  ) {
    return { ok: false, reason: "PRESENCE_BLOCKED" };
  }
  if (!canObserveVisually(receiverPresence)) {
    return { ok: false, reason: "CAPABILITY_BLOCKED" };
  }
  return null;
}

/**
 * Apply one structured knowledge transfer.
 * Clients cannot supply resultingState / factSnapshot — taken from sender knowledge only.
 */
export function applyKnowledgeTransferAction(opts: {
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  sourceType: KnowledgeTransferSource;
  action: PersonaSecretTransferAction;
  db?: Database.Database;
}): KnowledgeTransferApplyResult {
  const db = opts.db ?? getDb();
  ensureKnowledgeTransferSchema(db);

  if (!ALLOWED_SOURCES.has(opts.sourceType)) {
    return { ok: false, reason: "FORBIDDEN_SOURCE" };
  }

  const { action } = opts;

  const provenanceResult = resolveKnowledgeTransferVariantProvenance({
    chatId: opts.chatId,
    sourceAssistantMessageId: action.sourceAssistantMessageId ?? null,
    sourceGenerationSequence: action.sourceGenerationSequence ?? null,
    db,
  });
  if (!provenanceResult.ok) {
    return { ok: false, reason: provenanceResult.reason };
  }
  const provenance = provenanceResult.provenance;
  // SERVER_DISCLOSURE is reserved for authoritative server/creator paths.
  if (
    action.transferType === "SERVER_DISCLOSURE" &&
    opts.sourceType === "USER_EXPLICIT_TRANSFER"
  ) {
    return { ok: false, reason: "FORBIDDEN_TRANSFER_TYPE" };
  }

  const actionRef = resolveKnowledgeTransferActionRef({
    sourceMessageId: action.sourceMessageId,
    sourceAssistantMessageId: action.sourceAssistantMessageId,
    sourceGenerationSequence: action.sourceGenerationSequence,
    actionId: action.actionId,
    authoritativeEventId: action.authoritativeEventId,
  });
  if (!actionRef) {
    return { ok: false, reason: "MISSING_ACTION_REF" };
  }

  const senderType = action.sender.observerType;
  const senderId = action.sender.observerId;
  const receiverType = action.receiver.observerType;
  const receiverId = action.receiver.observerId;

  if (senderType === receiverType && senderId === receiverId) {
    return { ok: false, reason: "SAME_OBSERVER" };
  }

  const senderObs = getChatObserver({
    chatId: opts.chatId,
    observerType: senderType,
    observerId: senderId,
    db,
  });
  if (!senderObs || senderObs.is_active !== 1) {
    return { ok: false, reason: "INVALID_SENDER" };
  }

  const receiverObs = getChatObserver({
    chatId: opts.chatId,
    observerType: receiverType,
    observerId: receiverId,
    db,
  });
  if (!receiverObs) {
    return { ok: false, reason: "INVALID_RECEIVER" };
  }
  if (receiverObs.is_active !== 1) {
    return { ok: false, reason: "RECEIVER_SCOPE" };
  }

  const secret = getPersonaSecretById(action.secretId, db);
  if (!secret || secret.is_active !== 1) {
    return { ok: false, reason: "SECRET_NOT_FOUND" };
  }
  if (secret.persona_id !== opts.personaId) {
    return { ok: false, reason: "SECRET_WRONG_PERSONA" };
  }

  const senderKnowledge = getObserverSecretKnowledge({
    chatId: opts.chatId,
    personaId: opts.personaId,
    secretId: action.secretId,
    observerType: senderType,
    observerId: senderId,
    db,
  });
  if (!senderKnowledge) {
    return { ok: false, reason: "SENDER_UNKNOWN" };
  }

  const senderState = senderKnowledge.knowledge_state;
  const factSnapshot = sanitizeRevealedFactForPrompt(
    senderKnowledge.fact_snapshot
  );
  if (!factSnapshot) {
    return { ok: false, reason: "SENDER_NO_FACT" };
  }

  // Cap: resulting_state <= sender_state (equality — never invent higher).
  const resultingState: PersonaSecretKnowledgeState = senderState;

  const channelBlock = validateSceneChannel(
    action.transferType,
    opts.chatId,
    senderType,
    senderId,
    receiverType,
    receiverId,
    db
  );
  if (channelBlock) return channelBlock;

  const idempotencyKey = buildKnowledgeTransferIdempotencyKey({
    chatId: opts.chatId,
    secretId: action.secretId,
    senderType,
    senderId,
    receiverType,
    receiverId,
    sourceMessageId: action.sourceMessageId,
    sourceAssistantMessageId: action.sourceAssistantMessageId,
    sourceGenerationSequence: action.sourceGenerationSequence,
    actionId: action.actionId,
    authoritativeEventId: action.authoritativeEventId,
    transferType: action.transferType,
  });
  if (!idempotencyKey) {
    return { ok: false, reason: "MISSING_ACTION_REF" };
  }

  let result: KnowledgeTransferApplyResult = {
    ok: true,
    changed: false,
    transferEventId: null,
    resultingState: null,
  };

  const tx = db.transaction(() => {
    const existingTransfer = db
      .prepare(
        `SELECT id, resulting_state FROM knowledge_transfer_events
         WHERE idempotency_key=?`
      )
      .get(idempotencyKey) as
      | { id: string; resulting_state: PersonaSecretKnowledgeState }
      | undefined;

    if (existingTransfer) {
      result = {
        ok: true,
        changed: false,
        transferEventId: existingTransfer.id,
        resultingState: existingTransfer.resulting_state,
        reason: "DUPLICATE",
      };
      return;
    }

    const transferEventId = randomUUID();
    const evidencePayload = {
      knowledgeTransferEventId: transferEventId,
      senderType,
      senderId,
      receiverType,
      receiverId,
      transferType: action.transferType,
      senderStateSnapshot: senderState,
      matcherVersion: KNOWLEDGE_TRANSFER_MATCHER_VERSION,
    };

    db.prepare(
      `INSERT INTO knowledge_transfer_events (
         id, idempotency_key, chat_id, turn_number, source_message_id,
         source_assistant_message_id, source_generation_sequence,
         persona_id, secret_id,
         sender_type, sender_id, receiver_type, receiver_id,
         sender_state_snapshot, resulting_state, fact_snapshot,
         transfer_type, source_type, channel_type, evidence_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      transferEventId,
      idempotencyKey,
      opts.chatId,
      opts.turnNumber,
      action.sourceMessageId ?? null,
      action.sourceAssistantMessageId ?? null,
      action.sourceGenerationSequence ?? null,
      opts.personaId,
      action.secretId,
      senderType,
      senderId,
      receiverType,
      receiverId,
      senderState,
      resultingState,
      factSnapshot,
      action.transferType,
      opts.sourceType,
      "DIRECT",
      JSON.stringify(evidencePayload)
    );

    const evidenceId = randomUUID();
    const evidenceIdempotencyKey = `kte:${idempotencyKey}`;
    const evidenceInsert = db
      .prepare(
        `INSERT OR IGNORE INTO persona_secret_evidence_events (
           id, idempotency_key, chat_id, turn_number, source_message_id,
           persona_id, secret_id, discovery_rule_id,
           observer_type, observer_id, method, source_type, resulting_state,
           revealed_fact_snapshot, evidence_json
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        evidenceId,
        evidenceIdempotencyKey,
        opts.chatId,
        opts.turnNumber,
        action.sourceMessageId ?? null,
        opts.personaId,
        action.secretId,
        null,
        receiverType,
        receiverId,
        "KNOWLEDGE_TRANSFER",
        opts.sourceType,
        resultingState,
        factSnapshot,
        JSON.stringify(evidencePayload)
      );

    let lastEvidenceEventId: string = evidenceId;
    if (evidenceInsert.changes === 0) {
      const existingEvidence = db
        .prepare(
          `SELECT id FROM persona_secret_evidence_events WHERE idempotency_key=?`
        )
        .get(evidenceIdempotencyKey) as { id: string } | undefined;
      lastEvidenceEventId = existingEvidence?.id ?? evidenceId;
    }

    if (isVariantScopedProvenance(provenance)) {
      insertVariantScopedEvidenceActivation({
        evidenceId: lastEvidenceEventId,
        chatId: opts.chatId,
        assistantMessageId: provenance.sourceAssistantMessageId,
        generationSequence: provenance.sourceGenerationSequence,
        isActive: false,
        db,
      });
      finalizeVariantScopedTransferActivation(db, {
        chatId: opts.chatId,
        assistantMessageId: provenance.sourceAssistantMessageId,
        receiver: { observerType: receiverType, observerId: receiverId },
        personaId: opts.personaId,
        secretId: action.secretId,
      });
    }

    const projected = reprojectObserverSecretKnowledge({
      chatId: opts.chatId,
      personaId: opts.personaId,
      secretId: action.secretId,
      observerType: receiverType,
      observerId: receiverId,
      db,
    });

    result = {
      ok: true,
      changed: projected.changed,
      transferEventId,
      resultingState:
        projected.state === "UNKNOWN" ? resultingState : projected.state,
    };
  });

  tx();
  return result;
}
