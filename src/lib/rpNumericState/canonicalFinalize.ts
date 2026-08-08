/**
 * Phase B1-C — Atomic message + numeric state + status mirror finalize.
 *
 * Single BEGIN IMMEDIATE transaction:
 *   preflight → bootstrap → mutate/replace → mirror → finalize message
 */
import type Database from "better-sqlite3";
import type { GenerationStatus } from "@/lib/streamingPersistence";
import { finalizeAssistantMessageCore } from "@/lib/streamingPersistence";
import { isCanonicalDerivedStateGenerationStatus } from "@/lib/rpDerivedStateLifecycle";
import type { ParsedStatusWidgetTurnValues, StatusWidget } from "@/lib/statusWidget/types";
import { serializeStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import type { MessageVariant } from "@/lib/messageAlternates";
import {
  buildNumericBootstrapMutationId,
  buildNumericGenerationMutationId,
  listCanonicalEligibleNumericFields,
  type CanonicalEligibleNumericField,
} from "./canonicalPolicy";
import {
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  commitNumericStateReplacementCore,
  getNumericStateCurrent,
} from "./persistence";
import {
  mirrorCanonicalNumericValuesIntoStatusPayload,
  readLegacyNumericBaselineFromStatusPayload,
  readNumericProposalFromStatusPayload,
} from "./statusMirror";
import type { CommitNumericStateProposalResult } from "./persistence";

type Db = Database.Database;

export type AtomicNumericAssistantFinalizeInput = {
  assistantMessageId: number;
  chatId: number;
  characterId?: number | null;
  content: string;
  model: string;
  usageJson: string;
  variants: MessageVariant[];
  activeVariant: number;
  statusWidgetValues: ParsedStatusWidgetTurnValues | null;
  statusWidgetTurnActive?: number;
  generationStatus?: GenerationStatus;
  characterWidget: StatusWidget | null | undefined;
  /** Previous finalized canonical legacy status (for bootstrap baseline). */
  previousCanonicalStatus: ParsedStatusWidgetTurnValues | null;
  sourceTurn?: number | null;
  requestId?: string | null;
  generationSequence: number;
  isRegeneration: boolean;
};

export type AtomicNumericFieldCommit = {
  stateKey: string;
  result: CommitNumericStateProposalResult;
};

export type AtomicNumericAssistantFinalizeResult = {
  kind: "WROTE" | "IDEMPOTENT_FINALIZE_NOOP";
  wrote: boolean;
  statusWidgetValues: ParsedStatusWidgetTurnValues | null;
  statusWidgetValuesJson: string;
  variants: MessageVariant[];
  activeVariant: number;
  fieldCommits: AtomicNumericFieldCommit[];
};

function runImmediateTransaction<T>(db: Db, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

function ensureBootstrapped(
  db: Db,
  input: AtomicNumericAssistantFinalizeInput,
  field: CanonicalEligibleNumericField
): void {
  const existing = getNumericStateCurrent(db, input.chatId, field.stateKey);
  if (existing) return;

  const legacy = readLegacyNumericBaselineFromStatusPayload(
    input.previousCanonicalStatus,
    field
  );
  const sourceKind =
    legacy != null ? ("legacy_bootstrap" as const) : ("definition_initial" as const);
  const baselineValue = legacy != null ? legacy : field.definition.initial;

  bootstrapNumericStateCurrentCore(db, {
    chatId: input.chatId,
    characterId: input.characterId ?? null,
    stateKey: field.stateKey,
    definition: field.definition,
    baselineValue,
    mutationId: buildNumericBootstrapMutationId({
      chatId: input.chatId,
      stateKey: field.stateKey,
      sourceKind,
    }),
    sourceKind,
  });
}

/**
 * Atomic canonical finalize for numeric-eligible turns.
 * Must not be composed as finalizeAssistantMessage() + commitNumericStateProposal().
 */
export function executeAtomicNumericAssistantFinalize(
  db: Db,
  input: AtomicNumericAssistantFinalizeInput
): AtomicNumericAssistantFinalizeResult {
  const fields = listCanonicalEligibleNumericFields(input.characterWidget);
  const generationStatus = input.generationStatus ?? "completed";
  const allowNumericAdvance =
    isCanonicalDerivedStateGenerationStatus(generationStatus) && fields.length > 0;

  return runImmediateTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT generation_status FROM messages WHERE id=? AND chat_id=?`
      )
      .get(input.assistantMessageId, input.chatId) as
      | { generation_status: string | null }
      | undefined;

    if (!row) {
      return {
        kind: "IDEMPOTENT_FINALIZE_NOOP",
        wrote: false,
        statusWidgetValues: input.statusWidgetValues,
        statusWidgetValuesJson: input.statusWidgetValues
          ? serializeStatusWidgetValuesJson(input.statusWidgetValues)
          : "",
        variants: input.variants,
        activeVariant: input.activeVariant,
        fieldCommits: [],
      };
    }

    // Idempotent: already canonical-finalized → zero numeric mutations / no rewrite.
    if (
      row.generation_status === "completed" ||
      row.generation_status === "ok" ||
      row.generation_status === "completed_with_postprocess_error"
    ) {
      return {
        kind: "IDEMPOTENT_FINALIZE_NOOP",
        wrote: false,
        statusWidgetValues: input.statusWidgetValues,
        statusWidgetValuesJson: input.statusWidgetValues
          ? serializeStatusWidgetValuesJson(input.statusWidgetValues)
          : "",
        variants: input.variants,
        activeVariant: input.activeVariant,
        fieldCommits: [],
      };
    }

    const fieldCommits: AtomicNumericFieldCommit[] = [];
    const afterByStateKey: Record<string, number> = {};

    if (allowNumericAdvance) {
      const mutationId = buildNumericGenerationMutationId({
        assistantMessageId: input.assistantMessageId,
        generationSequence: input.generationSequence,
        requestId: input.requestId,
      });

      for (const field of fields) {
        ensureBootstrapped(db, input, field);
        const proposal = readNumericProposalFromStatusPayload(
          input.statusWidgetValues,
          field
        );

        const result = input.isRegeneration
          ? commitNumericStateReplacementCore(db, {
              chatId: input.chatId,
              characterId: input.characterId ?? null,
              stateKey: field.stateKey,
              definition: field.definition,
              proposal,
              mutationId,
              sourceKind: "extractor",
              sourceTurn: input.sourceTurn ?? null,
              assistantMessageId: input.assistantMessageId,
              requestId: input.requestId ?? null,
              generationSequence: input.generationSequence,
            })
          : commitNumericStateProposalCore(db, {
              chatId: input.chatId,
              characterId: input.characterId ?? null,
              stateKey: field.stateKey,
              definition: field.definition,
              proposal,
              mutationId,
              sourceKind: "extractor",
              sourceTurn: input.sourceTurn ?? null,
              assistantMessageId: input.assistantMessageId,
              requestId: input.requestId ?? null,
              generationSequence: input.generationSequence,
            });

        fieldCommits.push({ stateKey: field.stateKey, result });
        afterByStateKey[field.stateKey] = result.current.numericValue;
      }
    }

    const mirroredValues =
      allowNumericAdvance && fields.length > 0
        ? mirrorCanonicalNumericValuesIntoStatusPayload(
            input.statusWidgetValues,
            fields,
            afterByStateKey
          )
        : input.statusWidgetValues;

    const statusWidgetValuesJson = mirroredValues
      ? serializeStatusWidgetValuesJson(mirroredValues)
      : "";

    const variants = input.variants.map((v, idx) =>
      idx === input.activeVariant
        ? { ...v, statusWidgetValues: mirroredValues }
        : v
    );

    const finalizeResult = finalizeAssistantMessageCore(db, {
      assistantMessageId: input.assistantMessageId,
      chatId: input.chatId,
      content: input.content,
      model: input.model,
      usageJson: input.usageJson,
      alternatesJson: JSON.stringify(variants),
      activeVariant: input.activeVariant,
      statusWidgetValuesJson,
      statusWidgetTurnActive: input.statusWidgetTurnActive,
      generationStatus,
    });

    return {
      kind: finalizeResult.wrote ? "WROTE" : "IDEMPOTENT_FINALIZE_NOOP",
      wrote: finalizeResult.wrote,
      statusWidgetValues: mirroredValues,
      statusWidgetValuesJson:
        finalizeResult.statusWidgetValuesJson ?? statusWidgetValuesJson,
      variants,
      activeVariant: input.activeVariant,
      fieldCommits,
    };
  });
}
