/**
 * Phase B1-D2 — Canonical numeric variant selection projection.
 *
 * LAST GENERATED != CANONICAL
 * ACTIVE SELECTED VARIANT == CANONICAL
 *
 * Selection appends a new `variant_switch` ledger event that copies the
 * previously canonicalized extractor result. Does NOT rewind revision and
 * does NOT re-run the numeric reducer.
 *
 * Transaction-free: caller owns BEGIN IMMEDIATE / COMMIT.
 */
import type Database from "better-sqlite3";
import {
  fingerprintNumericStateDefinition,
  NUMERIC_STATE_POLICY_VERSION,
} from "@/lib/statusWidget/numericStateDefinition";
import type { CanonicalEligibleNumericField } from "./canonicalPolicy";
import {
  buildNumericIdempotencyKey,
  getNumericStateCurrent,
  getNumericStateEventById,
  sanitizeMutationId,
  sanitizeNumericStateKey,
} from "./persistence";
import {
  NumericVariantChainNotReadyError,
  NumericVariantSourceNotReadyError,
  type NumericEventOutcome,
  type NumericStateEventRow,
  type NumericStateCurrentRow,
} from "./types";

type Db = Database.Database;

export function buildNumericVariantSelectionMutationId(input: {
  assistantMessageId: number;
  generationSequence: number;
  tipEventId: number;
}): string {
  return sanitizeMutationId(
    `sel:${input.assistantMessageId}:g${input.generationSequence}:tip${input.tipEventId}`
  );
}

/**
 * Resolve the original extractor generation event for a selected variant.
 * Fail-closed on ambiguity / missing provenance.
 */
export function resolveSelectedVariantGenerationEvent(
  db: Db,
  input: {
    chatId: number;
    stateKey: string;
    assistantMessageId: number;
    generationSequence: number | null | undefined;
    requestId?: string | null;
  }
): NumericStateEventRow {
  if (
    input.generationSequence == null ||
    !Number.isSafeInteger(input.generationSequence) ||
    input.generationSequence < 0
  ) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: generationSequence missing"
    );
  }

  const stateKey = sanitizeNumericStateKey(input.stateKey);
  const req = String(input.requestId ?? "").trim();
  const rows = db
    .prepare(
      `SELECT id FROM rp_numeric_state_events
       WHERE chat_id=? AND state_key=? AND assistant_message_id=?
         AND generation_sequence=? AND source_kind='extractor'
       ORDER BY id ASC`
    )
    .all(
      input.chatId,
      stateKey,
      input.assistantMessageId,
      input.generationSequence
    ) as Array<{ id: number }>;

  let matched = rows
    .map((r) => getNumericStateEventById(db, r.id))
    .filter((e): e is NumericStateEventRow => e != null);

  if (req) {
    matched = matched.filter((e) => String(e.requestId ?? "").trim() === req);
  }

  if (matched.length === 0) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: source generation event missing"
    );
  }
  if (matched.length > 1) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: multiple matching generation events"
    );
  }

  const event = matched[0]!;
  if (event.assistantMessageId !== input.assistantMessageId) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: assistant_message_id mismatch"
    );
  }
  if (event.stateKey !== stateKey) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: state_key mismatch"
    );
  }
  if (event.beforeValue == null || !Number.isFinite(event.beforeValue)) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: selected source before_value missing"
    );
  }
  if (event.afterValue == null || !Number.isFinite(event.afterValue)) {
    throw new NumericVariantSourceNotReadyError(
      "numeric_state_variant_source_not_ready: selected source after_value invalid"
    );
  }
  return event;
}

function assertCurrentChainReady(
  db: Db,
  input: {
    chatId: number;
    stateKey: string;
    assistantMessageId: number;
  }
): { current: NumericStateCurrentRow; tip: NumericStateEventRow } {
  const current = getNumericStateCurrent(db, input.chatId, input.stateKey);
  if (!current) {
    throw new NumericVariantChainNotReadyError(
      "numeric_state_variant_chain_not_ready: current missing"
    );
  }
  if (current.lastSourceMessageId !== input.assistantMessageId) {
    throw new NumericVariantChainNotReadyError(
      "numeric_state_variant_chain_not_ready: last_source_message_id mismatch"
    );
  }
  if (current.lastEventId == null) {
    throw new NumericVariantChainNotReadyError(
      "numeric_state_variant_chain_not_ready: last_event_id missing"
    );
  }
  const tip = getNumericStateEventById(db, current.lastEventId);
  if (
    !tip ||
    tip.chatId !== input.chatId ||
    tip.stateKey !== input.stateKey ||
    tip.assistantMessageId !== input.assistantMessageId
  ) {
    throw new NumericVariantChainNotReadyError(
      "numeric_state_variant_chain_not_ready: tip event mismatch"
    );
  }
  return { current, tip };
}

export type ProjectNumericStateToSelectedVariantInput = {
  chatId: number;
  characterId?: number | null;
  assistantMessageId: number;
  selectedGenerationSequence: number | null | undefined;
  selectedRequestId?: string | null;
  sourceTurn?: number | null;
  fields: CanonicalEligibleNumericField[];
  /** Optional test hook — throw after first field write. */
  __testThrowAfterFirstField?: boolean;
};

export type ProjectNumericStateToSelectedVariantResult = {
  kind: "APPLIED" | "IDEMPOTENT_NOOP";
  afterByStateKey: Record<string, number>;
  selectionEvents: NumericStateEventRow[];
  affectedStateCount: number;
};

/**
 * Project numeric current onto the selected variant worldline.
 * Copies source extractor after/before/deltas — never re-runs reducer.
 */
export function projectNumericStateToSelectedVariantCore(
  db: Db,
  input: ProjectNumericStateToSelectedVariantInput
): ProjectNumericStateToSelectedVariantResult {
  // Only fields whose current tip is owned by this assistant message are
  // affected by this turn's variant selection (other pilot keys may still be
  // at bootstrap / prior-turn tip).
  const affectedFields = input.fields.filter((field) => {
    const current = getNumericStateCurrent(db, input.chatId, field.stateKey);
    return current?.lastSourceMessageId === input.assistantMessageId;
  });

  if (!affectedFields.length) {
    throw new NumericVariantChainNotReadyError(
      "numeric_state_variant_chain_not_ready: no numeric tip for assistant"
    );
  }

  const afterByStateKey: Record<string, number> = {};
  const selectionEvents: NumericStateEventRow[] = [];
  let wrote = 0;

  for (const field of affectedFields) {
    const { current, tip } = assertCurrentChainReady(db, {
      chatId: input.chatId,
      stateKey: field.stateKey,
      assistantMessageId: input.assistantMessageId,
    });

    const source = resolveSelectedVariantGenerationEvent(db, {
      chatId: input.chatId,
      stateKey: field.stateKey,
      assistantMessageId: input.assistantMessageId,
      generationSequence: input.selectedGenerationSequence,
      requestId: input.selectedRequestId,
    });

    // Same pre-turn baseline across A/B/C/D lineage tip vs selected source.
    if (
      tip.beforeValue == null ||
      !Number.isFinite(tip.beforeValue) ||
      tip.beforeValue !== source.beforeValue
    ) {
      throw new NumericVariantChainNotReadyError(
        "numeric_state_variant_chain_not_ready: pre-turn baseline mismatch"
      );
    }

    // Already at selected worldline tip (same after + same generation) → skip write.
    if (
      current.numericValue === source.afterValue &&
      current.lastGenerationSequence === source.generationSequence &&
      tip.sourceKind === "variant_switch" &&
      tip.afterValue === source.afterValue
    ) {
      afterByStateKey[field.stateKey] = source.afterValue!;
      continue;
    }
    // Tip is already the selected extractor event itself.
    if (tip.id === source.id && current.numericValue === source.afterValue) {
      afterByStateKey[field.stateKey] = source.afterValue!;
      continue;
    }

    const mutationId = buildNumericVariantSelectionMutationId({
      assistantMessageId: input.assistantMessageId,
      generationSequence: source.generationSequence ?? 0,
      tipEventId: tip.id,
    });
    // Previously-canonicalized source result replay: preserve source
    // policy/definition provenance. Selection ops already record
    // source_kind=variant_switch + replaces_event_id.
    const definitionHash =
      source.definitionHash ??
      fingerprintNumericStateDefinition(field.definition);
    const policyVersion = source.policyVersion || NUMERIC_STATE_POLICY_VERSION;
    const idempotencyKey = buildNumericIdempotencyKey({
      chatId: input.chatId,
      stateKey: field.stateKey,
      mutationId,
      sourceKind: "variant_switch",
    });

    const existingByKey = db
      .prepare(`SELECT id FROM rp_numeric_state_events WHERE idempotency_key=?`)
      .get(idempotencyKey) as { id: number } | undefined;
    if (existingByKey) {
      const existing = getNumericStateEventById(db, existingByKey.id);
      if (existing?.afterValue != null) {
        afterByStateKey[field.stateKey] = existing.afterValue;
        selectionEvents.push(existing);
        continue;
      }
    }

    const revisionBefore = current.revision;
    const revisionAfter = revisionBefore + 1;
    const insertEvent = db.prepare(`
      INSERT INTO rp_numeric_state_events (
        chat_id, character_id, state_key, mutation_id,
        before_value, proposed_value, proposed_delta, applied_delta, after_value,
        outcome, adjustments_json,
        source_turn, assistant_message_id, request_id, generation_sequence,
        source_kind, replaces_event_id,
        revision_before, revision_after,
        policy_version, definition_hash, idempotency_key
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?
      )
    `);
    const eventInfo = insertEvent.run(
      input.chatId,
      input.characterId ?? current.characterId,
      field.stateKey,
      mutationId,
      source.beforeValue,
      source.proposedValue,
      source.proposedDelta,
      source.appliedDelta,
      source.afterValue,
      source.outcome as NumericEventOutcome,
      JSON.stringify(source.adjustments),
      input.sourceTurn ?? source.sourceTurn,
      input.assistantMessageId,
      source.requestId,
      source.generationSequence,
      "variant_switch",
      tip.id,
      revisionBefore,
      revisionAfter,
      policyVersion,
      definitionHash,
      idempotencyKey
    );
    const eventId = Number(eventInfo.lastInsertRowid);

    db.prepare(`
      UPDATE rp_numeric_state_current
      SET numeric_value = ?,
          revision = ?,
          last_event_id = ?,
          last_source_turn = ?,
          last_source_message_id = ?,
          last_request_id = ?,
          last_generation_sequence = ?,
          character_id = COALESCE(?, character_id),
          updated_at = datetime('now')
      WHERE chat_id = ? AND state_key = ?
    `).run(
      source.afterValue,
      revisionAfter,
      eventId,
      input.sourceTurn ?? source.sourceTurn,
      input.assistantMessageId,
      source.requestId,
      source.generationSequence,
      input.characterId ?? null,
      input.chatId,
      field.stateKey
    );

    const written = getNumericStateEventById(db, eventId)!;
    afterByStateKey[field.stateKey] = source.afterValue!;
    selectionEvents.push(written);
    wrote += 1;

    if (input.__testThrowAfterFirstField && wrote === 1 && input.fields.length > 1) {
      throw new Error("TEST_THROW_AFTER_FIRST_NUMERIC_FIELD");
    }
  }

  return {
    kind: wrote > 0 ? "APPLIED" : "IDEMPOTENT_NOOP",
    afterByStateKey,
    selectionEvents,
    affectedStateCount: Object.keys(afterByStateKey).length,
  };
}
