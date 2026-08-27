/**
 * S4 variant provenance — single fail-closed validation owner.
 * All variant-scoped DB writes must pass through this resolver first.
 */

import type Database from "better-sqlite3";
import type { KnowledgeTransferRejectReason } from "@/lib/knowledgeTransferTypes";
import {
  normalizeMessageVariants,
  parseMessageVariants,
} from "@/lib/messageAlternates";

export type KnowledgeTransferVariantProvenanceScope =
  | { scope: "VARIANT_UNSCOPED" }
  | {
      scope: "VARIANT_SCOPED";
      sourceAssistantMessageId: number;
      sourceGenerationSequence: number;
    };

export type ResolveKnowledgeTransferVariantProvenanceResult =
  | { ok: true; provenance: KnowledgeTransferVariantProvenanceScope }
  | { ok: false; reason: KnowledgeTransferRejectReason };

function isNullProvenanceField(value: number | null | undefined): boolean {
  return value == null;
}

function assistantMessageHasGenerationSequence(
  row: {
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
  },
  requestedGenerationSequence: number
): boolean {
  const alternates = parseMessageVariants(row.alternates);
  if (alternates.length > 0) {
    return alternates.some(
      (variant) =>
        Number.isInteger(variant.generationSequence) &&
        variant.generationSequence === requestedGenerationSequence
    );
  }
  if (!row.content.trim()) return false;
  const { variants } = normalizeMessageVariants(row);
  return variants.some(
    (variant) =>
      Number.isInteger(variant.generationSequence) &&
      variant.generationSequence === requestedGenerationSequence
  );
}

/**
 * Sole owner for variant provenance scope validation.
 *
 * CASE A — both null → VARIANT_UNSCOPED (legacy / USER_EXPLICIT_TRANSFER).
 * CASE B — exactly one set → INVALID_VARIANT_PROVENANCE (no unscoped fallback).
 * CASE C — both set → validate message + exact generationSequence on stored variants.
 */
export function resolveKnowledgeTransferVariantProvenance(opts: {
  chatId: number;
  sourceAssistantMessageId: number | null | undefined;
  sourceGenerationSequence: number | null | undefined;
  db: Database.Database;
}): ResolveKnowledgeTransferVariantProvenanceResult {
  const assistantId = opts.sourceAssistantMessageId;
  const generation = opts.sourceGenerationSequence;
  const assistantMissing = isNullProvenanceField(assistantId);
  const generationMissing = isNullProvenanceField(generation);

  if (assistantMissing && generationMissing) {
    return { ok: true, provenance: { scope: "VARIANT_UNSCOPED" } };
  }

  if (assistantMissing !== generationMissing) {
    return { ok: false, reason: "INVALID_VARIANT_PROVENANCE" };
  }

  if (
    !Number.isInteger(assistantId) ||
    assistantId! <= 0 ||
    !Number.isInteger(generation) ||
    generation! < 0
  ) {
    return { ok: false, reason: "INVALID_VARIANT_PROVENANCE" };
  }

  const messageId = assistantId!;
  const generationSequence = generation!;

  const row = opts.db
    .prepare(
      `SELECT chat_id, role, content, model, usage, alternates, active_variant
       FROM messages WHERE id=?`
    )
    .get(messageId) as
    | {
        chat_id: number;
        role: string;
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    | undefined;

  if (!row) {
    return { ok: false, reason: "VARIANT_PROVENANCE_MESSAGE_NOT_FOUND" };
  }
  if (row.chat_id !== opts.chatId) {
    return { ok: false, reason: "VARIANT_PROVENANCE_WRONG_CHAT" };
  }
  if (row.role !== "assistant") {
    return { ok: false, reason: "VARIANT_PROVENANCE_NON_ASSISTANT" };
  }

  if (
    !assistantMessageHasGenerationSequence(row, generationSequence)
  ) {
    return { ok: false, reason: "VARIANT_PROVENANCE_UNKNOWN_GENERATION" };
  }

  return {
    ok: true,
    provenance: {
      scope: "VARIANT_SCOPED",
      sourceAssistantMessageId: messageId,
      sourceGenerationSequence: generationSequence,
    },
  };
}

/**
 * Active generation for variant-scoped S4 activation sync.
 * Fail-closed: returns null when message/variant/generation provenance is invalid.
 * Never infers generation from variant index.
 */
export function currentActiveKnowledgeTransferGenerationSequence(
  db: Database.Database,
  chatId: number,
  assistantMessageId: number
): number | null {
  const row = db
    .prepare(
      `SELECT chat_id, role, content, model, usage, alternates, active_variant
       FROM messages WHERE id=? AND chat_id=?`
    )
    .get(assistantMessageId, chatId) as
    | {
        chat_id: number;
        role: string;
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    | undefined;

  if (!row || row.role !== "assistant") return null;

  const { variants, activeVariant } = normalizeMessageVariants(row);
  const active = variants[activeVariant];
  if (!active) return null;

  const sequence = active.generationSequence;
  if (!Number.isInteger(sequence) || sequence == null || sequence < 0) {
    return null;
  }

  if (!assistantMessageHasGenerationSequence(row, sequence)) {
    return null;
  }

  return sequence;
}

/** @deprecated Use resolveKnowledgeTransferVariantProvenance result instead. */
export function isVariantScopedProvenance(
  provenance: KnowledgeTransferVariantProvenanceScope
): provenance is Extract<
  KnowledgeTransferVariantProvenanceScope,
  { scope: "VARIANT_SCOPED" }
> {
  return provenance.scope === "VARIANT_SCOPED";
}
