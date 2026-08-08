/**
 * Phase B1-A/B/C/D1/D2 — Server-authoritative RP numeric state.
 * Canonical writes are fail-closed (ENABLED + kill switch; default OFF).
 * B1-D1: no user/character allowlist on canonical path.
 * B1-D2: selected active variant = only canonical worldline.
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
  NumericHistoricalVariantReplayUnsupportedError,
  NumericRegenChainInvalidError,
  NumericStateInvalidCurrentError,
  NumericStateNotBootstrappedError,
  NumericStateValidationError,
  NumericVariantChainNotReadyError,
  NumericVariantFrontierMovedError,
  NumericVariantSourceNotReadyError,
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
  NumericTurnDeleteChainNotReadyError,
  revertNumericStateForDeletedAssistant,
  revertNumericStateForDeletedAssistantCore,
} from "./turnDeleteRevert";

export type {
  NumericTurnDeleteRestoreRow,
  RevertNumericStateForDeletedAssistantResult,
} from "./turnDeleteRevert";

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

export { evaluateNumericRegenChainReadiness } from "./regenChainGate";

export type {
  NumericRegenChainGateCode,
  NumericRegenChainReadiness,
} from "./regenChainGate";

export {
  buildNumericVariantSelectionMutationId,
  projectNumericStateToSelectedVariantCore,
  resolveSelectedVariantGenerationEvent,
} from "./variantSelection";

export type {
  ProjectNumericStateToSelectedVariantInput,
  ProjectNumericStateToSelectedVariantResult,
} from "./variantSelection";

export { executeAtomicNumericVariantSwitch } from "./variantSwitchAtomic";

export type {
  AtomicNumericVariantSwitchInput,
  AtomicNumericVariantSwitchResult,
} from "./variantSwitchAtomic";
