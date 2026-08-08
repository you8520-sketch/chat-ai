/**
 * Phase B1-D2 — Atomic numeric latest-frontier variant switch.
 *
 * BEGIN IMMEDIATE:
 *   frontier recheck → numeric projection → status mirror →
 *   message/episodic/trigger mutation core
 *
 * Post-commit trigger re-eval is caller-owned (best-effort).
 */
import type Database from "better-sqlite3";
import type { MessageVariant } from "@/lib/messageAlternates";
import {
  executeVariantSwitchMutationCore,
  hasLaterCanonicalTurn,
  isCanonicalFrontierAssistantMessage,
  type AtomicVariantSwitchInput,
} from "@/lib/rpDerivedStateLifecycle";
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

export type AtomicNumericVariantSwitchInput = {
  chatId: number;
  characterId: number;
  userId: number;
  messageId: number;
  variantIndex: number;
  variants: MessageVariant[];
  content: string;
  model: string;
  usageJson: string | null;
  adultRouteMetaJson: string;
  sourceTurn: number;
  characterWidget: StatusWidget | null | undefined;
  /** @internal test-only */
  __testThrowAfterNumeric?: boolean;
  /** @internal test-only */
  __testThrowAfterMessageUpdate?: boolean;
  /** @internal test-only */
  __testThrowAfterEpisodic?: boolean;
  /** @internal test-only */
  __testThrowAfterTriggerSupersession?: boolean;
};

export type AtomicNumericVariantSwitchResult = {
  kind: "APPLIED" | "IDEMPOTENT_NOOP";
  statusWidgetValuesJson: string | undefined;
  statusWidgetTurnActive: boolean | undefined;
  afterByStateKey: Record<string, number>;
  canonicalStatusForTriggers: ParsedStatusWidgetTurnValues | null;
};

function runImmediateTransaction<T>(db: Db, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

export function executeAtomicNumericVariantSwitch(
  db: Db,
  input: AtomicNumericVariantSwitchInput
): AtomicNumericVariantSwitchResult {
  return runImmediateTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT id, chat_id, active_variant
         FROM messages WHERE id=? AND chat_id=?`
      )
      .get(input.messageId, input.chatId) as
      | { id: number; chat_id: number; active_variant: number | null }
      | undefined;
    if (!row) {
      throw new NumericVariantFrontierMovedError(
        "variant_switch_frontier_moved: message missing"
      );
    }

    if (row.active_variant === input.variantIndex) {
      return {
        kind: "IDEMPOTENT_NOOP",
        statusWidgetValuesJson: undefined,
        statusWidgetTurnActive: undefined,
        afterByStateKey: {},
        canonicalStatusForTriggers: null,
      };
    }

    if (hasLaterCanonicalTurn(db, input.chatId, input.messageId)) {
      throw new NumericHistoricalVariantReplayUnsupportedError();
    }
    if (!isCanonicalFrontierAssistantMessage(db, input.chatId, input.messageId)) {
      throw new NumericVariantFrontierMovedError();
    }

    const selected = input.variants[input.variantIndex];
    if (!selected) {
      throw new Error("selected variant missing");
    }

    const fields = listCanonicalEligibleNumericFields(input.characterWidget);
    const numericProjected = projectNumericStateToSelectedVariantCore(db, {
      chatId: input.chatId,
      characterId: input.characterId,
      assistantMessageId: input.messageId,
      selectedGenerationSequence: selected.generationSequence,
      selectedRequestId: selected.requestId ?? null,
      sourceTurn: input.sourceTurn,
      fields,
      __testThrowAfterFirstField:
        input.__testThrowAfterNumeric === true && fields.length > 1,
    });

    if (input.__testThrowAfterNumeric && fields.length <= 1) {
      throw new Error("TEST_THROW_AFTER_NUMERIC_PROJECTION");
    }

    const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
      selected,
      "statusWidgetValues"
    );

    let statusWidgetValuesJson: string | undefined;
    let canonicalStatus: ParsedStatusWidgetTurnValues | null =
      selected.statusWidgetValues ?? null;

    if (fields.length > 0) {
      canonicalStatus = mirrorCanonicalNumericValuesIntoStatusPayload(
        selected.statusWidgetValues ?? null,
        fields,
        numericProjected.afterByStateKey
      );
      statusWidgetValuesJson = serializeStatusWidgetValuesJson(canonicalStatus);
    } else if (hasVariantStatusSnapshot) {
      statusWidgetValuesJson = selected.statusWidgetValues
        ? serializeStatusWidgetValuesJson(selected.statusWidgetValues)
        : "";
    }

    const variantsForStore = input.variants.map((v, i) => {
      if (i !== input.variantIndex) return v;
      if (!fields.length || !canonicalStatus) return v;
      return { ...v, statusWidgetValues: canonicalStatus };
    });

    const mutationInput: AtomicVariantSwitchInput = {
      chatId: input.chatId,
      messageId: input.messageId,
      content: input.content,
      model: input.model,
      usageJson: input.usageJson,
      adultRouteMetaJson: input.adultRouteMetaJson,
      variantsJson: JSON.stringify(variantsForStore),
      variantIndex: input.variantIndex,
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      sourceTurn: input.sourceTurn,
      characterId: input.characterId,
      userId: input.userId,
      selectedFacts: selected.statusWidgetValues?.extracted_facts ?? [],
      selectedRequestId: selected.requestId ?? null,
      selectedGenerationSequence: selected.generationSequence ?? null,
      __testThrowAfterMessageUpdate: input.__testThrowAfterMessageUpdate,
      __testThrowAfterEpisodic: input.__testThrowAfterEpisodic,
      __testThrowAfterTriggerSupersession:
        input.__testThrowAfterTriggerSupersession,
    };

    executeVariantSwitchMutationCore(db, mutationInput);

    return {
      kind: "APPLIED",
      statusWidgetValuesJson,
      statusWidgetTurnActive: selected.statusWidgetTurnActive,
      afterByStateKey: numericProjected.afterByStateKey,
      canonicalStatusForTriggers: canonicalStatus,
    };
  });
}
