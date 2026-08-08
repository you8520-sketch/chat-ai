/**
 * Phase B1-A — Server-authoritative RP numeric state types.
 * Dormant foundation: no route wiring.
 */
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";

export type { ServerMeterNumericStateDefinitionV1 };

/** Ledger / bootstrap source kinds supported in B1-A. */
export type NumericStateSourceKind =
  | "definition_initial"
  | "legacy_bootstrap"
  | "extractor"
  | "manual_override";

/** Reducer mutation sources (proposal path only). */
export type NumericReducerSourceKind = "extractor" | "manual_override";

export type NumericReducerOutcome = "APPLIED" | "NO_CHANGE" | "INVALID_HOLD";

export type NumericReducerAdjustment =
  | "CLAMPED_MIN"
  | "CLAMPED_MAX"
  | "DELTA_LIMITED_UP"
  | "DELTA_LIMITED_DOWN"
  | "INTEGER_COERCED";

export type NumericReducerInput = {
  definition: ServerMeterNumericStateDefinitionV1;
  beforeValue: number;
  proposal: string | number | null | undefined;
  sourceKind: NumericReducerSourceKind;
};

export type NumericReducerResult = {
  beforeValue: number;
  proposedValue: number | null;
  proposedDelta: number | null;
  appliedDelta: number;
  afterValue: number;
  outcome: NumericReducerOutcome;
  adjustments: NumericReducerAdjustment[];
};

/** DB event outcomes (IDEMPOTENT_NOOP is a return result, not stored). */
export type NumericEventOutcome =
  | "INITIALIZED"
  | "APPLIED"
  | "NO_CHANGE"
  | "INVALID_HOLD";

export type NumericCommitResultKind =
  | "APPLIED"
  | "NO_CHANGE"
  | "INVALID_HOLD"
  | "IDEMPOTENT_NOOP"
  | "INITIALIZED"
  | "ALREADY_BOOTSTRAPPED";

export type NumericStateCurrentRow = {
  chatId: number;
  characterId: number | null;
  stateKey: string;
  numericValue: number;
  revision: number;
  lastEventId: number | null;
  lastSourceTurn: number | null;
  lastSourceMessageId: number | null;
  lastRequestId: string | null;
  lastGenerationSequence: number | null;
};

export type NumericStateEventRow = {
  id: number;
  chatId: number;
  characterId: number | null;
  stateKey: string;
  mutationId: string;
  beforeValue: number | null;
  proposedValue: number | null;
  proposedDelta: number | null;
  appliedDelta: number | null;
  afterValue: number | null;
  outcome: NumericEventOutcome;
  adjustments: NumericReducerAdjustment[];
  sourceTurn: number | null;
  assistantMessageId: number | null;
  requestId: string | null;
  generationSequence: number | null;
  sourceKind: NumericStateSourceKind;
  replacesEventId: number | null;
  revisionBefore: number | null;
  revisionAfter: number | null;
  policyVersion: number;
  definitionHash: string | null;
  idempotencyKey: string;
};

export class NumericStateNotBootstrappedError extends Error {
  readonly code = "NUMERIC_STATE_NOT_BOOTSTRAPPED" as const;
  constructor(message = "NUMERIC_STATE_NOT_BOOTSTRAPPED") {
    super(message);
    this.name = "NumericStateNotBootstrappedError";
  }
}

export class NumericStateInvalidCurrentError extends Error {
  readonly code = "INVALID_CURRENT_STATE" as const;
  constructor(message = "INVALID_CURRENT_STATE") {
    super(message);
    this.name = "NumericStateInvalidCurrentError";
  }
}

export class NumericStateValidationError extends Error {
  readonly code = "NUMERIC_STATE_VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "NumericStateValidationError";
  }
}
