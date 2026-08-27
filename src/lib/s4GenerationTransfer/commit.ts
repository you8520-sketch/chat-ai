/**
 * Post-finalize S4 commit — accepted assistant generation only.
 */

import type Database from "better-sqlite3";
import type { KnowledgeTransferApplyResult } from "@/lib/knowledgeTransferTypes";
import {
  applyVariantScopedAuthoritativeKnowledgeTransfer,
  currentActiveKnowledgeTransferGenerationSequence,
} from "@/lib/knowledgeTransferVariant";
import { captureS4TransferEnvelopeFromModelText } from "./controlChannel";
import {
  S4_MAX_TRANSFER_EVENTS,
  S4_PROOF_TEXT_MAX_CHARS,
  type S4FactRef,
  type S4GenerationTransferContext,
  type S4ReceiverRef,
  type S4StructuredTransferEvent,
} from "./types";

export type S4LiveCommitResult = {
  attempted: number;
  applied: number;
  results: KnowledgeTransferApplyResult[];
};

function isValidFactRef(ref: string, ctx: S4GenerationTransferContext): boolean {
  return ctx.facts.has(ref as S4FactRef);
}

function isValidReceiverRef(ref: string, ctx: S4GenerationTransferContext): boolean {
  return ctx.receivers.has(ref as S4ReceiverRef);
}

function validateEvent(
  event: S4StructuredTransferEvent,
  ctx: S4GenerationTransferContext,
  finalVisibleText: string
): boolean {
  if (event.completed !== true) return false;
  if (event.transferType !== "DIRECT_STATEMENT") return false;
  if (!isValidFactRef(event.factRef, ctx)) return false;
  if (!isValidReceiverRef(event.receiverRef, ctx)) return false;
  const proof = event.proofText.trim();
  if (!proof || proof.length > S4_PROOF_TEXT_MAX_CHARS) return false;
  return finalVisibleText.includes(proof);
}

function dedupeEvents(events: S4StructuredTransferEvent[]): S4StructuredTransferEvent[] {
  const seen = new Set<string>();
  const out: S4StructuredTransferEvent[] = [];
  for (const event of events) {
    const key = `${event.factRef}:${event.receiverRef}:${event.proofText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
    if (out.length >= S4_MAX_TRANSFER_EVENTS) break;
  }
  return out;
}

/**
 * Parse trusted structured metadata from raw model output, validate against
 * request-local context + final visible prose, delegate to S4 apply owner.
 * Generation provenance resolved strictly via #684 owner — no caller fallback.
 */
export function commitAcceptedAssistantS4Transfers(opts: {
  rawModelText: string;
  finalVisibleText: string;
  ctx: S4GenerationTransferContext;
  chatId: number;
  personaId: number;
  characterId: number;
  turnNumber: number;
  assistantMessageId: number;
  userMessageId?: number | null;
  db: Database.Database;
}): S4LiveCommitResult {
  const generationSequence = currentActiveKnowledgeTransferGenerationSequence(
    opts.db,
    opts.chatId,
    opts.assistantMessageId
  );
  if (generationSequence == null) {
    return { attempted: 0, applied: 0, results: [] };
  }

  const envelope = captureS4TransferEnvelopeFromModelText(opts.rawModelText);
  if (!envelope) {
    return { attempted: 0, applied: 0, results: [] };
  }
  if (envelope.nonce !== opts.ctx.nonce) {
    return { attempted: 0, applied: 0, results: [] };
  }

  const candidates = dedupeEvents(envelope.events).filter((event) =>
    validateEvent(event, opts.ctx, opts.finalVisibleText)
  );
  if (candidates.length === 0) {
    return { attempted: 0, applied: 0, results: [] };
  }

  const results: KnowledgeTransferApplyResult[] = [];
  let applied = 0;

  for (const event of candidates) {
    const fact = opts.ctx.facts.get(event.factRef as S4FactRef);
    const receiver = opts.ctx.receivers.get(event.receiverRef as S4ReceiverRef);
    if (!fact || !receiver) continue;

    const result = applyVariantScopedAuthoritativeKnowledgeTransfer({
      chatId: opts.chatId,
      personaId: opts.personaId,
      characterId: opts.characterId,
      turnNumber: opts.turnNumber,
      sourceAssistantMessageId: opts.assistantMessageId,
      sourceGenerationSequence: generationSequence,
      userMessageId: opts.userMessageId ?? null,
      action: {
        secretId: fact.secretId,
        sender: opts.ctx.sender,
        receiver: {
          observerType: receiver.observerType,
          observerId: receiver.observerId,
        },
        transferType: "DIRECT_STATEMENT",
      },
      db: opts.db,
    });
    results.push(result);
    if (result.ok && result.transferEventId) applied += 1;
  }

  return { attempted: candidates.length, applied, results };
}
