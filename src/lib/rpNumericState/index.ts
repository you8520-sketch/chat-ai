/**
 * Phase B1-A/B/C — Server-authoritative RP numeric state.
 * Canonical writes are fail-closed + allowlist (default OFF).
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
  bootstrapNumericStateCurrentCore,
  buildNumericIdempotencyKey,
  commitNumericStateProposal,
  commitNumericStateProposalCore,
  commitNumericStateReplacement,
  commitNumericStateReplacementCore,
  deleteNumericStateForChat,
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
  CommitNumericStateReplacementInput,
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
  NumericRegenChainInvalidError,
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

export {
  RP_NUMERIC_CANONICAL_PILOT_STATE_KEYS,
  RP_NUMERIC_STATE_ALLOWLIST_CHARACTERS_ENV,
  RP_NUMERIC_STATE_ALLOWLIST_USERS_ENV,
  RP_NUMERIC_STATE_ENABLED_ENV,
  RP_NUMERIC_STATE_KILL_SWITCH_ENV,
  buildNumericBootstrapMutationId,
  buildNumericGenerationMutationId,
  isPilotNumericCanonicalStateKey,
  listCanonicalEligibleNumericFields,
  resolveNumericCanonicalEligibility,
} from "./canonicalPolicy";

export type {
  CanonicalEligibleNumericField,
  NumericCanonicalEligibilityResult,
} from "./canonicalPolicy";

export {
  formatCanonicalNumericStatusValue,
  mirrorCanonicalNumericValuesIntoStatusPayload,
  numericCanonicalFieldsChanged,
  readLegacyNumericBaselineFromStatusPayload,
  readNumericProposalFromStatusPayload,
} from "./statusMirror";

export { executeAtomicNumericAssistantFinalize } from "./canonicalFinalize";

export type {
  AtomicNumericAssistantFinalizeInput,
  AtomicNumericAssistantFinalizeResult,
  AtomicNumericFieldCommit,
} from "./canonicalFinalize";
