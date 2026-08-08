/**
 * Phase B1-A/B — Server-authoritative RP numeric state foundation + shadow observer.
 * Shadow is diagnostic-only (default OFF). Persistence commit is still unused in routes.
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

export {
  RP_NUMERIC_SHADOW_PILOT_STATE_KEYS,
  RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS_ENV,
  RP_NUMERIC_STATE_SHADOW_ENABLED_ENV,
  RP_NUMERIC_STATE_SHADOW_USER_IDS_ENV,
  isPilotNumericShadowStateKey,
  listShadowEligibleNumericFields,
  parsePositiveIntAllowlist,
  resolveNumericShadowEligibility,
} from "./shadowPolicy";

export type {
  NumericShadowEligibilityResult,
  ShadowEligibleNumericField,
} from "./shadowPolicy";

export {
  aggregateNumericShadowObservations,
  classifyNumericProposalFormat,
  logNumericShadowObservation,
  observeNumericShadow,
  tryObserveNumericShadowForTurn,
} from "./shadowObserver";

export type {
  NumericShadowBaselineSource,
  NumericShadowObservation,
  NumericShadowOutcome,
  NumericShadowProposalFormat,
} from "./shadowObserver";