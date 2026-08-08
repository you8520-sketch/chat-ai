/**
 * Phase B1-D2 — Atomic numeric latest-frontier variant switch (final hardening).
 *
 * BEGIN IMMEDIATE:
 *   txn-local message re-read → frontier recheck → same-active noop →
 *   numeric projection → status mirror → message/episodic/trigger core →
 *   LTM rejected-worldline suppression
 *
 * Preloaded alternates/content from the route are NOT trusted.
 * Post-commit trigger re-eval remains caller-owned (best-effort).
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
  type AtomicVariantSwitchInput,
} from "@/lib/rpDerivedStateLifecycle";
import { reconcileMemoryAfterVariantSwitchCore } from "@/lib/memory/memory-variant-switch-reconcile";
import type { MemoryTier } from "@/lib/memory/memory-types";
import { serializeStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import type {
  ParsedStatusWidgetTurnValues,
  StatusWidget,
} from "@/lib/statusWidget/types";
import { listCanonicalEligibleNumericFields } from "./canonicalPolicy";
import { mirrorCanonicalNumericValuesIntoStatusPayload } from "./statusMirror";
import { projectNumericStateToSelectedVariantCore } from "./variantSelection";
import {
  NumericHistoricalVariantReplayUnsupportedError,
  NumericVariantFrontierMovedError,
} from "./types";

type Db = Database.Database;

export type AtomicNumericVariantSwitchMemoryOpts = {
  enabled: boolean;
  tier: MemoryTier;
  memoryCapacity: number;
};

export type AtomicNumericVariantSwitchInput = {
  chatId: number;
  characterId: number;
  userId: number;
  messageId: number;
  /** Requested client variant index; resolved against txn-local row. */
  variantIndex: number;
  characterWidget: StatusWidget | null | undefined;
  /** When enabled, LTM suppression runs inside the same BEGIN IMMEDIATE. */
  memory?: AtomicNumericVariantSwitchMemoryOpts;
  /**
   * @deprecated Ignored — transaction-local `messages` row is the source of truth.
   * Kept optional so older call sites compile during migration.
   */
  variants?: MessageVariant[];
  /** @deprecated Ignored — see variants. */
  content?: string;
  /** @deprecated Ignored — see variants. */
  model?: string;
  /** @deprecated Ignored — see variants. */
  usageJson?: string | null;
  /** @deprecated Ignored — see variants. */
  adultRouteMetaJson?: string;
  /** @deprecated Ignored — recomputed via getAssistantSourceTurn inside txn. */
  sourceTurn?: number;
  /** @internal test-only */
  __testThrowAfterNumeric?: boolean;
  /** @internal test-only */
  __testThrowAfterMessageUpdate?: boolean;
  /** @internal test-only */
  __testThrowAfterEpisodic?: boolean;
  /** @internal test-only */
  __testThrowAfterTriggerSupersession?: boolean;
  /** @internal test-only */
  __testThrowAfterLtmInvalidate?: boolean;
  /** @internal test-only */
  __testThrowAfterLtmRebuild?: boolean;
};

export type AtomicNumericVariantSwitchApplied = {
  kind: "APPLIED";
  statusWidgetValuesJson: string | undefined;
  statusWidgetTurnActive: boolean | undefined;
  afterByStateKey: Record<string, number>;
  canonicalStatusForTriggers: ParsedStatusWidgetTurnValues | null;
  activeVariant: number;
  selectedContent: string;
  selectedModel: string;
  selectedUsage: MessageVariant["usage"];
  selectedRequestId: string | null;
  selectedGenerationSequence: number | null;
  /** Canonical variants as committed (numeric status mirrored on active). */
  canonicalVariants: MessageVariant[];
  memoryReconciled: boolean;
  sourceTurn: number;
};

export type AtomicNumericVariantSwitchIdempotent = {
  kind: "IDEMPOTENT_NOOP";
  statusWidgetValuesJson: undefined;
  statusWidgetTurnActive: undefined;
  afterByStateKey: Record<string, number>;
  canonicalStatusForTriggers: null;
  activeVariant: number;
  selectedContent: string;
  selectedModel: string;
  selectedUsage: MessageVariant["usage"];
  selectedRequestId: string | null;
  selectedGenerationSequence: number | null;
  canonicalVariants: MessageVariant[];
  memoryReconciled: false;
  sourceTurn: number | null;
};

export type AtomicNumericVariantSwitchResult =
  | AtomicNumericVariantSwitchApplied
  | AtomicNumericVariantSwitchIdempotent;

function runImmediateTransaction<T>(db: Db, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

function adultRouteMetaJsonFromVariant(variant: MessageVariant | undefined): string {
  return variant?.usage?.adultRouting
    ? JSON.stringify(variant.usage.adultRouting)
    : "";
}

/**
 * BEGIN IMMEDIATE atomic numeric variant switch.
 *
 * Transaction-local source of truth: re-reads `messages` row inside the txn
 * (never trusts preloaded alternates/content). Same-active is resolved here
 * as IDEMPOTENT_NOOP. LTM rejected-worldline suppression runs in the same txn.
 */
export function executeAtomicNumericVariantSwitch(
  db: Db,
  input: AtomicNumericVariantSwitchInput
): AtomicNumericVariantSwitchResult {
  return runImmediateTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT id, chat_id, role, content, model, usage, adult_route_meta_json,
                alternates, active_variant, generation_status,
                status_widget_values_json, status_widget_turn_active
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
          status_widget_values_json: string | null;
          status_widget_turn_active: number | null;
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
        statusWidgetValuesJson: undefined,
        statusWidgetTurnActive: undefined,
        afterByStateKey: {},
        canonicalStatusForTriggers: null,
        activeVariant: txnActive,
        selectedContent: fields.content,
        selectedModel: fields.model,
        selectedUsage: selected.usage ?? null,
        selectedRequestId,
        selectedGenerationSequence,
        canonicalVariants: txnVariants,
        memoryReconciled: false,
        sourceTurn,
      };
    }

    if (hasLaterCanonicalTurn(db, input.chatId, input.messageId)) {
      throw new NumericHistoricalVariantReplayUnsupportedError();
    }
    if (!isCanonicalFrontierAssistantMessage(db, input.chatId, input.messageId)) {
      throw new NumericVariantFrontierMovedError();
    }

    const eligibleFields = listCanonicalEligibleNumericFields(input.characterWidget);
    const numericProjected = projectNumericStateToSelectedVariantCore(db, {
      chatId: input.chatId,
      characterId: input.characterId,
      assistantMessageId: input.messageId,
      selectedGenerationSequence: selected.generationSequence,
      selectedRequestId: selected.requestId ?? null,
      sourceTurn: sourceTurn ?? 0,
      fields: eligibleFields,
      __testThrowAfterFirstField:
        input.__testThrowAfterNumeric === true && eligibleFields.length > 1,
    });

    if (input.__testThrowAfterNumeric && eligibleFields.length <= 1) {
      throw new Error("TEST_THROW_AFTER_NUMERIC_PROJECTION");
    }

    const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
      selected,
      "statusWidgetValues"
    );

    let statusWidgetValuesJson: string | undefined;
    let canonicalStatus: ParsedStatusWidgetTurnValues | null =
      selected.statusWidgetValues ?? null;

    if (eligibleFields.length > 0) {
      canonicalStatus = mirrorCanonicalNumericValuesIntoStatusPayload(
        selected.statusWidgetValues ?? null,
        eligibleFields,
        numericProjected.afterByStateKey
      );
      statusWidgetValuesJson = serializeStatusWidgetValuesJson(canonicalStatus);
    } else if (hasVariantStatusSnapshot) {
      statusWidgetValuesJson = selected.statusWidgetValues
        ? serializeStatusWidgetValuesJson(selected.statusWidgetValues)
        : "";
    }

    const variantsForStore = txnVariants.map((v, i) => {
      if (i !== input.variantIndex) return v;
      if (!eligibleFields.length || !canonicalStatus) return v;
      return { ...v, statusWidgetValues: canonicalStatus };
    });

    const mutationInput: AtomicVariantSwitchInput = {
      chatId: input.chatId,
      messageId: input.messageId,
      content: fields.content,
      model: fields.model,
      usageJson: fields.usage,
      adultRouteMetaJson: adultRouteMetaJsonFromVariant(selected),
      variantsJson: JSON.stringify(variantsForStore),
      variantIndex: input.variantIndex,
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      sourceTurn: sourceTurn ?? 0,
      characterId: input.characterId,
      userId: input.userId,
      selectedFacts: selected.statusWidgetValues?.extracted_facts ?? [],
      selectedRequestId,
      selectedGenerationSequence,
      __testThrowAfterMessageUpdate: input.__testThrowAfterMessageUpdate,
      __testThrowAfterEpisodic: input.__testThrowAfterEpisodic,
      __testThrowAfterTriggerSupersession:
        input.__testThrowAfterTriggerSupersession,
    };

    executeVariantSwitchMutationCore(db, mutationInput);

    let memoryReconciled = false;
    if (input.memory?.enabled && sourceTurn != null && sourceTurn > 0) {
      const mem = reconcileMemoryAfterVariantSwitchCore(db, {
        chatId: input.chatId,
        userId: input.userId,
        characterId: input.characterId,
        tier: input.memory.tier,
        memoryCapacity: input.memory.memoryCapacity,
        sourceTurn,
        enabled: true,
        __testThrowAfterInvalidate: input.__testThrowAfterLtmInvalidate,
        __testThrowAfterRebuild: input.__testThrowAfterLtmRebuild,
      });
      memoryReconciled =
        mem.attempted &&
        (mem.inactivatedRecordIds.length > 0 || mem.lorebookRebuilt);
    }

    return {
      kind: "APPLIED",
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      afterByStateKey: numericProjected.afterByStateKey,
      canonicalStatusForTriggers: canonicalStatus,
      activeVariant: input.variantIndex,
      selectedContent: fields.content,
      selectedModel: fields.model,
      selectedUsage: selected.usage ?? null,
      selectedRequestId,
      selectedGenerationSequence,
      canonicalVariants: variantsForStore,
      memoryReconciled,
      sourceTurn: sourceTurn ?? 0,
    };
  });
}
