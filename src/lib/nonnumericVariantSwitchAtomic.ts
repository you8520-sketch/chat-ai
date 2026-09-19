/**
 * Nonnumeric latest-frontier variant switch — BEGIN IMMEDIATE owner.
 *
 * Transaction-local source of truth: re-reads `messages` row inside the txn,
 * rechecks canonical frontier, resolves variantIndex against current alternates,
 * then mutates. Route-level prechecks are UX-only fast rejection.
 */
import type Database from "better-sqlite3";
import {
  normalizeMessageVariants,
  variantToRowFields,
  type MessageVariant,
} from "@/lib/messageAlternates";
import {
  executeVariantSwitchMutationCore,
  getAssistantSourceTurn,
  hasLaterCanonicalTurn,
  isCanonicalDerivedStateGenerationStatus,
  isCanonicalFrontierAssistantMessage,
} from "@/lib/rpDerivedStateLifecycle";
import { assertS4VariantSwitchAllowed } from "@/lib/knowledgeTransferVariant";
import { resolveCanonicalSourceUserMessageIdCore } from "@/lib/memory/memory-source-boundary";
import { serializeStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import type { ExtractedStatusFact } from "@/lib/statusWidget/types";
import {
  NumericHistoricalVariantReplayUnsupportedError,
  NumericVariantFrontierMovedError,
} from "@/lib/rpNumericState/types";

type Db = Database.Database;

function runImmediateTransaction<T>(db: Db, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

function adultRouteMetaJsonFromVariant(variant: MessageVariant | undefined): string {
  return variant?.usage?.adultRouting
    ? JSON.stringify(variant.usage.adultRouting)
    : "";
}

export type AtomicNonnumericVariantSwitchInput = {
  chatId: number;
  characterId: number;
  userId: number;
  messageId: number;
  /** Requested client variant index; resolved against txn-local row. */
  variantIndex: number;
  /** @internal test-only — pause after frontier check, still inside BEGIN IMMEDIATE */
  __testPauseAfterFrontierCheck?: () => void;
  /** @internal test-only */
  __testThrowAfterMessageUpdate?: boolean;
  /** @internal test-only */
  __testThrowAfterEpisodic?: boolean;
  /** @internal test-only */
  __testThrowAfterTriggerSupersession?: boolean;
  /** @internal test-only */
  __testThrowAfterS4Activation?: boolean;
  /** @internal test-only */
  __testThrowAfterS4Reprojection?: boolean;
};

export type AtomicNonnumericVariantSwitchApplied = {
  kind: "APPLIED";
  activeVariant: number;
  selectedContent: string;
  selectedModel: string;
  selectedUsage: MessageVariant["usage"];
  selectedRequestId: string | null;
  selectedGenerationSequence: number | null;
  canonicalVariants: MessageVariant[];
  statusWidgetValuesJson: string | undefined;
  statusWidgetTurnActive: boolean | undefined;
  sourceTurn: number;
  selectedFacts: ExtractedStatusFact[];
};

export type AtomicNonnumericVariantSwitchIdempotent = {
  kind: "IDEMPOTENT_NOOP";
  activeVariant: number;
  selectedContent: string;
  selectedModel: string;
  selectedUsage: MessageVariant["usage"];
  selectedRequestId: string | null;
  selectedGenerationSequence: number | null;
  canonicalVariants: MessageVariant[];
  sourceTurn: number | null;
};

export type AtomicNonnumericVariantSwitchResult =
  | AtomicNonnumericVariantSwitchApplied
  | AtomicNonnumericVariantSwitchIdempotent;

/**
 * BEGIN IMMEDIATE atomic nonnumeric variant switch.
 * CHECK + WRITE share one transaction; frontier authority lives here.
 */
export function executeAtomicNonnumericVariantSwitch(
  db: Db,
  input: AtomicNonnumericVariantSwitchInput
): AtomicNonnumericVariantSwitchResult {
  return runImmediateTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT id, chat_id, role, content, model, usage, adult_route_meta_json,
                alternates, active_variant, generation_status
         FROM messages WHERE id=? AND chat_id=?`
      )
      .get(input.messageId, input.chatId) as
      | {
          id: number;
          chat_id: number;
          role: string;
          content: string;
          model: string;
          usage: string | null;
          adult_route_meta_json: string | null;
          alternates: string | null;
          active_variant: number | null;
          generation_status: string | null;
        }
      | undefined;

    if (!row || row.role !== "assistant") {
      throw new NumericVariantFrontierMovedError(
        "variant_switch_frontier_moved: message missing"
      );
    }
    if (!isCanonicalDerivedStateGenerationStatus(row.generation_status)) {
      throw new NumericVariantFrontierMovedError(
        "variant_switch_frontier_moved: generation incomplete"
      );
    }

    const { variants: txnVariants, activeVariant: txnActive } =
      normalizeMessageVariants({
        content: row.content,
        model: row.model,
        usage: row.usage,
        alternates: row.alternates,
        active_variant: row.active_variant,
      });

    if (
      !Number.isInteger(input.variantIndex) ||
      input.variantIndex < 0 ||
      input.variantIndex >= txnVariants.length
    ) {
      throw new Error("selected variant missing");
    }

    const selected = txnVariants[input.variantIndex]!;
    const fields = variantToRowFields(txnVariants, input.variantIndex);
    const sourceTurn = getAssistantSourceTurn(db, input.chatId, input.messageId);
    const selectedRequestId =
      selected.requestId != null ? String(selected.requestId) : null;
    const selectedGenerationSequence =
      selected.generationSequence != null &&
      Number.isInteger(selected.generationSequence)
        ? selected.generationSequence
        : null;

    if (txnActive === input.variantIndex) {
      return {
        kind: "IDEMPOTENT_NOOP",
        activeVariant: txnActive,
        selectedContent: fields.content,
        selectedModel: fields.model,
        selectedUsage: selected.usage ?? null,
        selectedRequestId,
        selectedGenerationSequence,
        canonicalVariants: txnVariants,
        sourceTurn,
      };
    }

    const laterCanonical = hasLaterCanonicalTurn(db, input.chatId, input.messageId);
    if (laterCanonical) {
      throw new NumericHistoricalVariantReplayUnsupportedError();
    }
    if (!isCanonicalFrontierAssistantMessage(db, input.chatId, input.messageId)) {
      throw new NumericVariantFrontierMovedError();
    }

    assertS4VariantSwitchAllowed(db, input.chatId, input.messageId, laterCanonical);

    input.__testPauseAfterFrontierCheck?.();

    const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
      selected,
      "statusWidgetValues"
    );
    const statusWidgetValuesJson = hasVariantStatusSnapshot
      ? selected.statusWidgetValues
        ? serializeStatusWidgetValuesJson(selected.statusWidgetValues)
        : ""
      : undefined;

    const sourceUserMessageId = resolveCanonicalSourceUserMessageIdCore(db, {
      chatId: input.chatId,
      assistantMessageId: input.messageId,
    });

    executeVariantSwitchMutationCore(db, {
      chatId: input.chatId,
      messageId: input.messageId,
      content: fields.content,
      model: fields.model,
      usageJson: fields.usage,
      adultRouteMetaJson: adultRouteMetaJsonFromVariant(selected),
      variantsJson: JSON.stringify(txnVariants),
      variantIndex: input.variantIndex,
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      sourceTurn: sourceTurn ?? 0,
      sourceUserMessageId,
      characterId: input.characterId,
      userId: input.userId,
      selectedFacts: selected.statusWidgetValues?.extracted_facts ?? [],
      selectedRequestId,
      selectedGenerationSequence,
      __testThrowAfterMessageUpdate: input.__testThrowAfterMessageUpdate,
      __testThrowAfterEpisodic: input.__testThrowAfterEpisodic,
      __testThrowAfterTriggerSupersession: input.__testThrowAfterTriggerSupersession,
      __testThrowAfterS4Activation: input.__testThrowAfterS4Activation,
      __testThrowAfterS4Reprojection: input.__testThrowAfterS4Reprojection,
    });

    return {
      kind: "APPLIED",
      activeVariant: input.variantIndex,
      selectedContent: fields.content,
      selectedModel: fields.model,
      selectedUsage: selected.usage ?? null,
      selectedRequestId,
      selectedGenerationSequence,
      canonicalVariants: txnVariants,
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      sourceTurn: sourceTurn ?? 0,
      selectedFacts: selected.statusWidgetValues?.extracted_facts ?? [],
    };
  });
}
