/**
 * Phase B1-A/C — atomic numeric state persistence primitives.
 *
 * B1-C: transaction-free *Core functions for outer atomic finalize.
 * Exported bootstrap/commit wrappers keep BEGIN IMMEDIATE (B1-A API unchanged).
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  fingerprintNumericStateDefinition,
  NUMERIC_STATE_POLICY_VERSION,
  normalizeNumericStateDefinition,
} from "@/lib/statusWidget/numericStateDefinition";
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import { reduceNumericStateProposal } from "./reducer";
import {
  NumericRegenChainInvalidError,
  NumericStateNotBootstrappedError,
  NumericStateValidationError,
  type NumericCommitResultKind,
  type NumericEventOutcome,
  type NumericReducerAdjustment,
  type NumericStateCurrentRow,
  type NumericStateEventRow,
  type NumericStateSourceKind,
} from "./types";

export const RP_NUMERIC_STATE_MAX_STATE_KEY_LEN = 64;
export const RP_NUMERIC_STATE_MAX_MUTATION_ID_LEN = 256;

/** Documented contract for C10 — commit/bootstrap wrappers use BEGIN IMMEDIATE. */
export const RP_NUMERIC_STATE_USES_BEGIN_IMMEDIATE = true;

type Db = Database.Database;

/**
 * Schema ownership: DB init / migration / explicit test setup only.
 * Must NOT be called from get/bootstrap/commit hot-path primitives.
 */
export function ensureRpNumericStateTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rp_numeric_state_current (
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      state_key TEXT NOT NULL,
      numeric_value REAL NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      last_event_id INTEGER,
      last_source_turn INTEGER,
      last_source_message_id INTEGER,
      last_request_id TEXT,
      last_generation_sequence INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, state_key)
    );
    CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_current_chat
      ON rp_numeric_state_current(chat_id, character_id);

    CREATE TABLE IF NOT EXISTS rp_numeric_state_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      state_key TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      before_value REAL,
      proposed_value REAL,
      proposed_delta REAL,
      applied_delta REAL,
      after_value REAL,
      outcome TEXT NOT NULL,
      adjustments_json TEXT NOT NULL DEFAULT '[]',
      source_turn INTEGER,
      assistant_message_id INTEGER,
      request_id TEXT,
      generation_sequence INTEGER,
      source_kind TEXT NOT NULL,
      replaces_event_id INTEGER,
      revision_before INTEGER,
      revision_after INTEGER,
      policy_version INTEGER NOT NULL DEFAULT 1,
      definition_hash TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_events_chat_key
      ON rp_numeric_state_events(chat_id, state_key, id);
    CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_events_message
      ON rp_numeric_state_events(chat_id, assistant_message_id);
    CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_events_mutation
      ON rp_numeric_state_events(mutation_id);
  `);
}

function runImmediateTransaction<T>(db: Db, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx.immediate();
}

export function sanitizeNumericStateKey(raw: string): string {
  const key = String(raw ?? "").trim();
  if (!key || key.length > RP_NUMERIC_STATE_MAX_STATE_KEY_LEN) {
    throw new NumericStateValidationError("invalid state_key");
  }
  return key;
}

export function sanitizeMutationId(raw: string): string {
  const id = String(raw ?? "").trim();
  if (!id || id.length > RP_NUMERIC_STATE_MAX_MUTATION_ID_LEN) {
    throw new NumericStateValidationError("invalid mutation_id");
  }
  return id;
}

export function buildNumericIdempotencyKey(input: {
  chatId: number;
  stateKey: string;
  mutationId: string;
  sourceKind: NumericStateSourceKind;
}): string {
  const material = [
    "rpns:v1",
    String(input.chatId),
    input.stateKey,
    input.mutationId,
    input.sourceKind,
  ].join("\n");
  return createHash("sha256").update(material).digest("hex");
}

function mapCurrentRow(row: {
  chat_id: number;
  character_id: number | null;
  state_key: string;
  numeric_value: number;
  revision: number;
  last_event_id: number | null;
  last_source_turn: number | null;
  last_source_message_id: number | null;
  last_request_id: string | null;
  last_generation_sequence: number | null;
}): NumericStateCurrentRow {
  return {
    chatId: row.chat_id,
    characterId: row.character_id,
    stateKey: row.state_key,
    numericValue: row.numeric_value,
    revision: row.revision,
    lastEventId: row.last_event_id,
    lastSourceTurn: row.last_source_turn,
    lastSourceMessageId: row.last_source_message_id,
    lastRequestId: row.last_request_id,
    lastGenerationSequence: row.last_generation_sequence,
  };
}

export function getNumericStateCurrent(
  db: Db,
  chatId: number,
  stateKey: string
): NumericStateCurrentRow | null {
  const row = db
    .prepare(
      `SELECT chat_id, character_id, state_key, numeric_value, revision,
              last_event_id, last_source_turn, last_source_message_id,
              last_request_id, last_generation_sequence
       FROM rp_numeric_state_current
       WHERE chat_id=? AND state_key=?`
    )
    .get(chatId, stateKey) as
    | {
        chat_id: number;
        character_id: number | null;
        state_key: string;
        numeric_value: number;
        revision: number;
        last_event_id: number | null;
        last_source_turn: number | null;
        last_source_message_id: number | null;
        last_request_id: string | null;
        last_generation_sequence: number | null;
      }
    | undefined;
  return row ? mapCurrentRow(row) : null;
}

export function getNumericStateEventById(
  db: Db,
  eventId: number
): NumericStateEventRow | null {
  const row = db
    .prepare(
      `SELECT id, chat_id, character_id, state_key, mutation_id,
              before_value, proposed_value, proposed_delta, applied_delta, after_value,
              outcome, adjustments_json, source_turn, assistant_message_id, request_id,
              generation_sequence, source_kind, replaces_event_id,
              revision_before, revision_after, policy_version, definition_hash, idempotency_key
       FROM rp_numeric_state_events WHERE id=?`
    )
    .get(eventId) as
    | {
        id: number;
        chat_id: number;
        character_id: number | null;
        state_key: string;
        mutation_id: string;
        before_value: number | null;
        proposed_value: number | null;
        proposed_delta: number | null;
        applied_delta: number | null;
        after_value: number | null;
        outcome: NumericEventOutcome;
        adjustments_json: string;
        source_turn: number | null;
        assistant_message_id: number | null;
        request_id: string | null;
        generation_sequence: number | null;
        source_kind: NumericStateSourceKind;
        replaces_event_id: number | null;
        revision_before: number | null;
        revision_after: number | null;
        policy_version: number;
        definition_hash: string | null;
        idempotency_key: string;
      }
    | undefined;
  if (!row) return null;
  let adjustments: NumericReducerAdjustment[] = [];
  try {
    const parsed = JSON.parse(row.adjustments_json || "[]");
    if (Array.isArray(parsed)) adjustments = parsed as NumericReducerAdjustment[];
  } catch {
    adjustments = [];
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    characterId: row.character_id,
    stateKey: row.state_key,
    mutationId: row.mutation_id,
    beforeValue: row.before_value,
    proposedValue: row.proposed_value,
    proposedDelta: row.proposed_delta,
    appliedDelta: row.applied_delta,
    afterValue: row.after_value,
    outcome: row.outcome,
    adjustments,
    sourceTurn: row.source_turn,
    assistantMessageId: row.assistant_message_id,
    requestId: row.request_id,
    generationSequence: row.generation_sequence,
    sourceKind: row.source_kind,
    replacesEventId: row.replaces_event_id,
    revisionBefore: row.revision_before,
    revisionAfter: row.revision_after,
    policyVersion: row.policy_version,
    definitionHash: row.definition_hash,
    idempotencyKey: row.idempotency_key,
  };
}

export type BootstrapNumericStateInput = {
  chatId: number;
  characterId?: number | null;
  stateKey: string;
  definition: ServerMeterNumericStateDefinitionV1;
  baselineValue: number;
  mutationId: string;
  sourceKind: "definition_initial" | "legacy_bootstrap";
};

export type BootstrapNumericStateResult = {
  kind: "INITIALIZED" | "ALREADY_BOOTSTRAPPED" | "IDEMPOTENT_NOOP";
  current: NumericStateCurrentRow;
  event: NumericStateEventRow | null;
};

function validateBootstrapInput(input: BootstrapNumericStateInput): {
  definition: ServerMeterNumericStateDefinitionV1;
  stateKey: string;
  mutationId: string;
  idempotencyKey: string;
  definitionHash: string;
} {
  const definition = normalizeNumericStateDefinition(input.definition);
  if (!definition) {
    throw new NumericStateValidationError("invalid numeric state definition");
  }
  const stateKey = sanitizeNumericStateKey(input.stateKey);
  const mutationId = sanitizeMutationId(input.mutationId);
  if (!Number.isFinite(input.baselineValue)) {
    throw new NumericStateValidationError("invalid baselineValue");
  }
  if (
    input.baselineValue < definition.min ||
    input.baselineValue > definition.max
  ) {
    throw new NumericStateValidationError("baselineValue outside definition range");
  }
  if (definition.integer && !Number.isSafeInteger(input.baselineValue)) {
    throw new NumericStateValidationError("baselineValue must be integer");
  }
  return {
    definition,
    stateKey,
    mutationId,
    idempotencyKey: buildNumericIdempotencyKey({
      chatId: input.chatId,
      stateKey,
      mutationId,
      sourceKind: input.sourceKind,
    }),
    definitionHash: fingerprintNumericStateDefinition(definition),
  };
}

/**
 * Transaction-free bootstrap core (B1-C). Caller owns BEGIN/COMMIT.
 * Does not swallow DB exceptions.
 */
export function bootstrapNumericStateCurrentCore(
  db: Db,
  input: BootstrapNumericStateInput
): BootstrapNumericStateResult {
  const { stateKey, mutationId, idempotencyKey, definitionHash } =
    validateBootstrapInput(input);

  const existingByKey = db
    .prepare(`SELECT id FROM rp_numeric_state_events WHERE idempotency_key=?`)
    .get(idempotencyKey) as { id: number } | undefined;
  if (existingByKey) {
    const current = getNumericStateCurrent(db, input.chatId, stateKey);
    if (!current) {
      throw new NumericStateValidationError(
        "idempotent bootstrap event without current row"
      );
    }
    return {
      kind: "IDEMPOTENT_NOOP",
      current,
      event: getNumericStateEventById(db, existingByKey.id),
    };
  }

  const existingCurrent = getNumericStateCurrent(db, input.chatId, stateKey);
  if (existingCurrent) {
    return {
      kind: "ALREADY_BOOTSTRAPPED",
      current: existingCurrent,
      event: null,
    };
  }

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
      NULL, ?, NULL, NULL, ?,
      'INITIALIZED', '[]',
      NULL, NULL, NULL, NULL,
      ?, NULL,
      0, 1,
      ?, ?, ?
    )
  `);
  const eventInfo = insertEvent.run(
    input.chatId,
    input.characterId ?? null,
    stateKey,
    mutationId,
    input.baselineValue,
    input.baselineValue,
    input.sourceKind,
    NUMERIC_STATE_POLICY_VERSION,
    definitionHash,
    idempotencyKey
  );
  const eventId = Number(eventInfo.lastInsertRowid);

  db.prepare(`
    INSERT INTO rp_numeric_state_current (
      chat_id, character_id, state_key, numeric_value, revision,
      last_event_id, last_source_turn, last_source_message_id,
      last_request_id, last_generation_sequence,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, 1,
      ?, NULL, NULL,
      NULL, NULL,
      datetime('now'), datetime('now')
    )
  `).run(
    input.chatId,
    input.characterId ?? null,
    stateKey,
    input.baselineValue,
    eventId
  );

  const current = getNumericStateCurrent(db, input.chatId, stateKey)!;
  const event = getNumericStateEventById(db, eventId)!;
  return { kind: "INITIALIZED", current, event };
}

/**
 * Create the first current row + INITIALIZED event atomically.
 * Existing current → no overwrite / no new event (unless same idempotency key).
 */
export function bootstrapNumericStateCurrent(
  db: Db,
  input: BootstrapNumericStateInput
): BootstrapNumericStateResult {
  return runImmediateTransaction(db, () =>
    bootstrapNumericStateCurrentCore(db, input)
  );
}

export type CommitNumericStateProposalInput = {
  chatId: number;
  characterId?: number | null;
  stateKey: string;
  definition: ServerMeterNumericStateDefinitionV1;
  proposal: string | number | null | undefined;
  mutationId: string;
  sourceKind: "extractor" | "manual_override";
  sourceTurn?: number | null;
  assistantMessageId?: number | null;
  requestId?: string | null;
  generationSequence?: number | null;
  replacesEventId?: number | null;
};

export type CommitNumericStateProposalResult = {
  kind: NumericCommitResultKind;
  current: NumericStateCurrentRow;
  event: NumericStateEventRow | null;
};

function validateCommitInput(input: CommitNumericStateProposalInput): {
  definition: ServerMeterNumericStateDefinitionV1;
  stateKey: string;
  mutationId: string;
  idempotencyKey: string;
  definitionHash: string;
} {
  const definition = normalizeNumericStateDefinition(input.definition);
  if (!definition) {
    throw new NumericStateValidationError("invalid numeric state definition");
  }
  const stateKey = sanitizeNumericStateKey(input.stateKey);
  const mutationId = sanitizeMutationId(input.mutationId);
  return {
    definition,
    stateKey,
    mutationId,
    idempotencyKey: buildNumericIdempotencyKey({
      chatId: input.chatId,
      stateKey,
      mutationId,
      sourceKind: input.sourceKind,
    }),
    definitionHash: fingerprintNumericStateDefinition(definition),
  };
}

function insertMutationEventAndUpdateCurrent(
  db: Db,
  input: {
    chatId: number;
    characterId?: number | null;
    stateKey: string;
    mutationId: string;
    sourceKind: NumericStateSourceKind;
    sourceTurn?: number | null;
    assistantMessageId?: number | null;
    requestId?: string | null;
    generationSequence?: number | null;
    replacesEventId?: number | null;
    definitionHash: string;
    idempotencyKey: string;
    beforeValue: number;
    proposedValue: number | null;
    proposedDelta: number | null;
    appliedDelta: number;
    afterValue: number;
    outcome: NumericEventOutcome;
    adjustments: NumericReducerAdjustment[];
    revisionBefore: number;
    currentCharacterId: number | null;
  }
): { eventId: number; current: NumericStateCurrentRow; event: NumericStateEventRow } {
  const revisionAfter = input.revisionBefore + 1;
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
    input.characterId ?? input.currentCharacterId,
    input.stateKey,
    input.mutationId,
    input.beforeValue,
    input.proposedValue,
    input.proposedDelta,
    input.appliedDelta,
    input.afterValue,
    input.outcome,
    JSON.stringify(input.adjustments),
    input.sourceTurn ?? null,
    input.assistantMessageId ?? null,
    input.requestId ?? null,
    input.generationSequence ?? null,
    input.sourceKind,
    input.replacesEventId ?? null,
    input.revisionBefore,
    revisionAfter,
    NUMERIC_STATE_POLICY_VERSION,
    input.definitionHash,
    input.idempotencyKey
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
    input.afterValue,
    revisionAfter,
    eventId,
    input.sourceTurn ?? null,
    input.assistantMessageId ?? null,
    input.requestId ?? null,
    input.generationSequence ?? null,
    input.characterId ?? null,
    input.chatId,
    input.stateKey
  );

  return {
    eventId,
    current: getNumericStateCurrent(db, input.chatId, input.stateKey)!,
    event: getNumericStateEventById(db, eventId)!,
  };
}

/**
 * Transaction-free normal proposal commit (B1-C). Caller owns BEGIN/COMMIT.
 * before = current.numeric_value. Does not swallow DB exceptions.
 */
export function commitNumericStateProposalCore(
  db: Db,
  input: CommitNumericStateProposalInput
): CommitNumericStateProposalResult {
  const { definition, stateKey, mutationId, idempotencyKey, definitionHash } =
    validateCommitInput(input);

  const existingByKey = db
    .prepare(`SELECT id FROM rp_numeric_state_events WHERE idempotency_key=?`)
    .get(idempotencyKey) as { id: number } | undefined;
  if (existingByKey) {
    const current = getNumericStateCurrent(db, input.chatId, stateKey);
    if (!current) {
      throw new NumericStateNotBootstrappedError();
    }
    return {
      kind: "IDEMPOTENT_NOOP",
      current,
      event: getNumericStateEventById(db, existingByKey.id),
    };
  }

  const current = getNumericStateCurrent(db, input.chatId, stateKey);
  if (!current) {
    throw new NumericStateNotBootstrappedError();
  }

  const reduced = reduceNumericStateProposal({
    definition,
    beforeValue: current.numericValue,
    proposal: input.proposal,
    sourceKind: input.sourceKind,
  });

  const written = insertMutationEventAndUpdateCurrent(db, {
    chatId: input.chatId,
    characterId: input.characterId,
    stateKey,
    mutationId,
    sourceKind: input.sourceKind,
    sourceTurn: input.sourceTurn,
    assistantMessageId: input.assistantMessageId,
    requestId: input.requestId,
    generationSequence: input.generationSequence,
    replacesEventId: input.replacesEventId,
    definitionHash,
    idempotencyKey,
    beforeValue: reduced.beforeValue,
    proposedValue: reduced.proposedValue,
    proposedDelta: reduced.proposedDelta,
    appliedDelta: reduced.appliedDelta,
    afterValue: reduced.afterValue,
    outcome: reduced.outcome as NumericEventOutcome,
    adjustments: reduced.adjustments,
    revisionBefore: current.revision,
    currentCharacterId: current.characterId,
  });

  return {
    kind: reduced.outcome,
    current: written.current,
    event: written.event,
  };
}

/**
 * Atomic proposal commit (BEGIN IMMEDIATE).
 * Requires prior bootstrap. Idempotent on (chat, stateKey, mutationId, sourceKind).
 */
export function commitNumericStateProposal(
  db: Db,
  input: CommitNumericStateProposalInput
): CommitNumericStateProposalResult {
  return runImmediateTransaction(db, () =>
    commitNumericStateProposalCore(db, input)
  );
}

export type CommitNumericStateReplacementInput = {
  chatId: number;
  characterId?: number | null;
  stateKey: string;
  definition: ServerMeterNumericStateDefinitionV1;
  proposal: string | number | null | undefined;
  mutationId: string;
  sourceKind: "extractor";
  sourceTurn?: number | null;
  assistantMessageId: number;
  requestId?: string | null;
  generationSequence?: number | null;
};

/**
 * Latest-regeneration replacement core (B1-C). Transaction-free.
 *
 * beforeValue = replaced event A.before_value (NOT current.after).
 * Event A is retained; B.replaces_event_id = A.id.
 */
export function commitNumericStateReplacementCore(
  db: Db,
  input: CommitNumericStateReplacementInput
): CommitNumericStateProposalResult {
  const { definition, stateKey, mutationId, idempotencyKey, definitionHash } =
    validateCommitInput(input);

  const existingByKey = db
    .prepare(`SELECT id FROM rp_numeric_state_events WHERE idempotency_key=?`)
    .get(idempotencyKey) as { id: number } | undefined;
  if (existingByKey) {
    const current = getNumericStateCurrent(db, input.chatId, stateKey);
    if (!current) {
      throw new NumericStateNotBootstrappedError();
    }
    return {
      kind: "IDEMPOTENT_NOOP",
      current,
      event: getNumericStateEventById(db, existingByKey.id),
    };
  }

  const current = getNumericStateCurrent(db, input.chatId, stateKey);
  if (!current) {
    throw new NumericStateNotBootstrappedError();
  }

  if (
    current.lastSourceMessageId !== input.assistantMessageId ||
    current.lastEventId == null
  ) {
    throw new NumericRegenChainInvalidError(
      "NUMERIC_REGEN_CHAIN_INVALID: current tip does not match assistant message"
    );
  }

  const replaced = getNumericStateEventById(db, current.lastEventId);
  if (
    !replaced ||
    replaced.chatId !== input.chatId ||
    replaced.stateKey !== stateKey ||
    replaced.assistantMessageId !== input.assistantMessageId
  ) {
    throw new NumericRegenChainInvalidError(
      "NUMERIC_REGEN_CHAIN_INVALID: replaced event mismatch"
    );
  }

  if (replaced.beforeValue == null || !Number.isFinite(replaced.beforeValue)) {
    throw new NumericRegenChainInvalidError(
      "NUMERIC_REGEN_CHAIN_INVALID: replaced event missing before_value"
    );
  }

  const reduced = reduceNumericStateProposal({
    definition,
    beforeValue: replaced.beforeValue,
    proposal: input.proposal,
    sourceKind: input.sourceKind,
  });

  const written = insertMutationEventAndUpdateCurrent(db, {
    chatId: input.chatId,
    characterId: input.characterId,
    stateKey,
    mutationId,
    sourceKind: input.sourceKind,
    sourceTurn: input.sourceTurn,
    assistantMessageId: input.assistantMessageId,
    requestId: input.requestId,
    generationSequence: input.generationSequence,
    replacesEventId: replaced.id,
    definitionHash,
    idempotencyKey,
    beforeValue: reduced.beforeValue,
    proposedValue: reduced.proposedValue,
    proposedDelta: reduced.proposedDelta,
    appliedDelta: reduced.appliedDelta,
    afterValue: reduced.afterValue,
    outcome: reduced.outcome as NumericEventOutcome,
    adjustments: reduced.adjustments,
    revisionBefore: current.revision,
    currentCharacterId: current.characterId,
  });

  return {
    kind: reduced.outcome,
    current: written.current,
    event: written.event,
  };
}

/** BEGIN IMMEDIATE wrapper for replacement (tests / standalone callers). */
export function commitNumericStateReplacement(
  db: Db,
  input: CommitNumericStateReplacementInput
): CommitNumericStateProposalResult {
  return runImmediateTransaction(db, () =>
    commitNumericStateReplacementCore(db, input)
  );
}

/** Delete all numeric ledger rows for a chat (whole-chat delete cleanup). */
export function deleteNumericStateForChat(db: Db, chatId: number): void {
  db.prepare(`DELETE FROM rp_numeric_state_events WHERE chat_id=?`).run(chatId);
  db.prepare(`DELETE FROM rp_numeric_state_current WHERE chat_id=?`).run(chatId);
}
