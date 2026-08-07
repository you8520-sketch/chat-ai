/**
 * Phase B1-A — Server-authoritative RP numeric state foundation.
 * NO runtime wiring. Import from tests / future B1-B/C only.
 */
export {
  fingerprintNumericStateDefinition,
  normalizeNumericStateDefinition,
  NUMERIC_STATE_POLICY_VERSION,
} from "@/lib/statusWidget/numericStateDefinition";

export {
  parseStrictNumericProposal,
  reduceNumericStateProposal,
} from "./reducer";

export {
  RP_NUMERIC_STATE_MAX_MUTATION_ID_LEN,
  RP_NUMERIC_STATE_MAX_STATE_KEY_LEN,
  RP_NUMERIC_STATE_USES_BEGIN_IMMEDIATE,
  bootstrapNumericStateCurrent,
  buildNumericIdempotencyKey,
  commitNumericStateProposal,
  ensureRpNumericStateTables,
  getNumericStateCurrent,
  getNumericStateEventById,
  sanitizeMutationId,
  sanitizeNumericStateKey,
} from "./persistence";

export type {
  BootstrapNumericStateInput,
  BootstrapNumericStateResult,
  CommitNumericStateProposalInput,
  CommitNumericStateProposalResult,
} from "./persistence";

export type {
  NumericCommitResultKind,
  NumericEventOutcome,
  NumericReducerAdjustment,
  NumericReducerInput,
  NumericReducerOutcome,
  NumericReducerResult,
  NumericReducerSourceKind,
  NumericStateCurrentRow,
  NumericStateEventRow,
  NumericStateSourceKind,
  ServerMeterNumericStateDefinitionV1,
} from "./types";

export {
  NumericStateInvalidCurrentError,
  NumericStateNotBootstrappedError,
  NumericStateValidationError,
} from "./types";
