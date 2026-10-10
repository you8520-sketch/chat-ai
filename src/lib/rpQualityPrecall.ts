/**
 * Deterministic PRECALL owner for the 4-model × 3-fixture Main RP prose
 * quality benchmark. Owns evidence schema, validation, and start gates only.
 * Does not own environment access results, call providers, mutate DB, bill
 * users, or score prose. Production prompt wording is not this file's job.
 */
import { createHash } from "node:crypto";

import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
  GEMINI_37_FLASH_DISPLAY_NAME,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import { applyOverseasCardFee, OVERSEAS_CARD_FEE_PERCENT } from "@/lib/billingFxPolicy";
import {
  getPublishedPricing,
  resolvePublishedReferenceRatesForPrompt,
} from "@/lib/publishedModelPricing";
import {
  ASSISTANT_MESSAGE_EDIT_MAX_CHARS,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { resolveStreamCharCap } from "@/lib/responseLength";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import {
  RP_QUALITY_CENTER_BAND_MAX_CHARS,
  classifyVisibleLength,
} from "@/lib/rpQualityBaseline";
import {
  RP_QUALITY_VERBOSITY_BIAS_INSTRUCTION,
  authoringEvaluationNotes,
  buildQualityEvaluationContract,
  buildQualityOutputPacket,
  liveAuthoringCapabilityMatrix,
  type RpQualityContentMode,
  type RpQualityOutputPacket,
  type RpQualityTurnKind,
} from "@/lib/rpQualityEvaluationPacket";
import {
  DEFAULT_USER_AUTHORING_LEVEL,
  capabilitiesFromUserAuthoringLevel,
  type UserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export const RP_QUALITY_PRECALL_VERSION = 1;
export const RP_QUALITY_PRECALL_PLANNED_CALLS = 12;
export const RP_QUALITY_PRECALL_RETRY = 0;
export const RP_QUALITY_PRECALL_FALLBACK = 0;
export const RP_QUALITY_PRECALL_AUXILIARY = 0;
export const RP_QUALITY_PRECALL_PAID_STATUS = "NOT_AUTHORIZED_PRECALL_ONLY" as const;

/**
 * PRECALL_READY is the only readiness owner. It means verified live identity
 * plus concrete A/B/C fixtures. It does not imply final-wire proof, an approved
 * cost bound, or paid authorization; those are separate gates.
 */
export const RP_QUALITY_PRECALL_READINESS_SCOPE = Object.freeze({
  precallReadyMeans: "VERIFIED_LIVE_IDENTITY_AND_CONCRETE_FIXTURES_ONLY",
  finalWireProofIsSeparate: true,
  costApprovalIsSeparate: true,
  paidExecutionGateIsSeparate: true,
} as const);

export const RP_QUALITY_PRECALL_CLASSIFICATIONS = [
  "PRECALL_READY",
  "ROOT_CAUSE_UNCONFIRMED",
  "NOT_REPRODUCIBLE",
] as const;
export type RpQualityPrecallClassification =
  (typeof RP_QUALITY_PRECALL_CLASSIFICATIONS)[number];

export const RP_QUALITY_PRECALL_FIXTURE_IDS = [
  "A_relationship_emotion",
  "B_conflict_action_spatial",
  "C_continuity_progression",
] as const;
export type RpQualityPrecallFixtureId =
  (typeof RP_QUALITY_PRECALL_FIXTURE_IDS)[number];

/** Historical recorded hashes only. Not current production proof. */
export const HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT =
  "2f5cb0b416ce214dfeb109f50622c0a45d61f62a";
export const HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER =
  "scripts/lib/mainRpBodyCuePreflight.ts#LIVE_DEPLOYED_ROW_PROOF";

export const RP_QUALITY_PRECALL_HISTORICAL_ROW_POINTER = Object.freeze({
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  recordedDeployCommit: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT,
  recordedProofOwner: HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER,
  isCurrentProductionProof: false as const,
});

/** Benchmark target selector. Not an assumed current production proof. */
export const RP_QUALITY_PRECALL_TARGET_SELECTOR = Object.freeze({
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
});

/**
 * Operator-only Railway hash probe. Not executed by this library.
 * Persona hash must use toPublicPersonaDescription(), never raw DB description.
 */
export const RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT = Object.freeze({
  dbPath: "/data/app.db",
  sqliteUriMode: "ro",
  pragmaQueryOnly: true,
  personaHashOwner: "personaSecretLegacyMarkers.toPublicPersonaDescription",
  allow: [
    "deploy SHA",
    "ids/names",
    "uniqueness booleans/counts",
    "text lengths",
    "SHA-256 hashes",
    "used/public metadata",
  ],
  forbid: [
    "character source text",
    "persona raw description",
    "greeting/system/world source text",
  ],
});

export const PRECALL_GREETING_STIMULUS_OWNER =
  "scripts/lib/rpModelQualificationFixture.ts#buildGreetingBodyCueReviewCases";
export const PRECALL_SCENE_SEED_OWNER =
  "scripts/lib/rpModelQualificationFixture.ts#COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS";

export const RP_QUALITY_PRECALL_MUTATION_POLICY = Object.freeze({
  chat: false,
  session: false,
  userPoints: false,
  db: false,
  productionChatSession: false,
  backgroundMemory: false,
  suggestedReply: false,
  regeneration: false,
  continuation: false,
});

export const RP_QUALITY_PRECALL_EXECUTION_POLICY = Object.freeze({
  retry: RP_QUALITY_PRECALL_RETRY,
  fallback: RP_QUALITY_PRECALL_FALLBACK,
  auxiliary: RP_QUALITY_PRECALL_AUXILIARY,
  plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
  paidProviderCallsThisOwner: 0,
});

export type RpQualityPrecallOwnerRow = {
  responsibility: string;
  canonicalOwner: string;
  effectiveValueSource: string;
  scope: string;
  otherReaders: readonly string[];
  duplicateOrStaleOwner: string;
};

export const RP_QUALITY_PRECALL_OWNER_MAP: readonly RpQualityPrecallOwnerRow[] = [
  {
    responsibility: "active model registry",
    canonicalOwner: "chatModels.MAIN_RP_USER_SELECTABLE_OPTIONS",
    effectiveValueSource: "MAIN_RP_USER_SELECTABLE_OPTIONS → MAIN_RP_MODEL_IDS",
    scope: "user-selectable Main RP picker only",
    otherReaders: [
      "rpQualityEvaluationPacket.RP_QUALITY_BENCHMARK_MODELS",
      "scripts/lib/rpActiveModelQualityLive.RP_ACTIVE_MODEL_QUALITY_MODEL_IDS",
      "this PRECALL plan",
    ],
    duplicateOrStaleOwner: "none — PRECALL derives, does not invent a second list",
  },
  {
    responsibility: "deployed character/persona snapshot",
    canonicalOwner: "production Railway /data/app.db characters + personas",
    effectiveValueSource:
      "externally injected immutable live proof; library validates and fail-closes when absent",
    scope: "current production rows, not historical qualification dumps",
    otherReaders: [
      "scripts/lib/mainRpBodyCuePreflight.LIVE_DEPLOYED_ROW_PROOF (historical KEEP)",
      "scripts/lib/rpModelQualificationFixture (HISTORICAL_ONLY 2026-08-25, not this source)",
      "src/lib/rpMainRpStyleLengthFixture (MAIN_RP_STYLE_LENGTH identity gate)",
      "scripts/lib/rpMainRpStyleLengthGolden (owned production-request parity; caller provenance is not trusted)",
    ],
    duplicateOrStaleOwner:
      "environment access observations are operator evidence, not library state; LIVE_DEPLOYED_ROW_PROOF @ 2f5cb0b4 cannot auto-satisfy current proof",
  },
  {
    responsibility: "current authoring policy",
    canonicalOwner: "userAuthoringPolicy.capabilitiesFromUserAuthoringLevel",
    effectiveValueSource: "DEFAULT_USER_AUTHORING_LEVEL = NORMAL",
    scope: "ordinary Main RP turns",
    otherReaders: [
      "contextBuilder currentTurnAuthoringDelegation",
      "rpQualityEvaluationPacket.authoringEvaluationNotes",
    ],
    duplicateOrStaleOwner: "stale 'AI must never write user action/dialogue' scoring rule",
  },
  {
    responsibility: "current content mode",
    canonicalOwner: "session/runtime content mode — not characters.nsfw listing",
    effectiveValueSource: "SAFE for this 12-call prose pilot",
    scope: "this PRECALL plan only",
    otherReaders: ["rpQualityEvaluationPacket contentMode"],
    duplicateOrStaleOwner:
      "characters.nsfw is listing/content-rating only; 19+ dedicated bench is FOLLOW-UP",
  },
  {
    responsibility: "deterministic benchmark stimulus",
    canonicalOwner:
      "rpModelQualificationFixture.buildGreetingBodyCueReviewCases + COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS",
    effectiveValueSource:
      "current greeting as history opening + frozen scene seeds; not mutable current-room history",
    scope: "history seed + current user turn + evaluation focus",
    otherReaders: ["this PRECALL plan"],
    duplicateOrStaleOwner:
      "do not rewrite the 2026-08-25 dump opening onto the current character; do not copy seed user-turn text into a second owner",
  },
  {
    responsibility: "context builder",
    canonicalOwner: "services/contextBuilder.ts#buildContext",
    effectiveValueSource: "current main production path",
    scope: "final system + history before provider adapt",
    otherReaders: ["assemblePrimaryRpRequest callers"],
    duplicateOrStaleOwner: "none",
  },
  {
    responsibility: "final system/user assembly",
    canonicalOwner: "openRouterAdult.assemblePrimaryRpRequest + buildOpenRouterMessages",
    effectiveValueSource: "current main production path",
    scope: "provider-ready messages before transport adapt",
    otherReaders: ["mainRpFinalWireAudit", "adminEffectiveRuntimeSettings"],
    duplicateOrStaleOwner: "none",
  },
  {
    responsibility: "per-model adapter/routing/reasoning",
    canonicalOwner:
      "selectedAIProvider + resolveMainRpPrimaryWireModelId + resolveMainRpOpenRouterRoutePolicy + adaptRequestBodyForTransport",
    effectiveValueSource: "intended product differences per Main RP model",
    scope: "provider, wire model, route policy, reasoning, cache representation",
    otherReaders: ["openRouterClient / cheaperInference adapt"],
    duplicateOrStaleOwner: "do not flatten adapters for fairness",
  },
  {
    responsibility: "provider wire request",
    canonicalOwner: "assemblePrimaryRpRequest.requestBody",
    effectiveValueSource: "not assembled until a later paid-execution owner",
    scope: "one physical POST per planned sample, later",
    otherReaders: ["this PRECALL start gate"],
    duplicateOrStaleOwner: "none",
  },
  {
    responsibility: "output capture",
    canonicalOwner: "this PRECALL sample artifact + buildQualityOutputPacket",
    effectiveValueSource: "empty until a later authorized paid run",
    scope: "raw output + deterministic metadata only",
    otherReaders: ["GPT/user review"],
    duplicateOrStaleOwner: "Cursor must not fill scores",
  },
  {
    responsibility: "visible-text normalization",
    canonicalOwner: "chatDisplayLength.visibleAssistantDisplayText / CharCount",
    effectiveValueSource: "same projection as production chat display",
    scope: "visible chars / paragraphs / dialogue-share estimate",
    otherReaders: ["rpQualityEvaluationPacket.buildQualityOutputMetadata"],
    duplicateOrStaleOwner: "none",
  },
  {
    responsibility: "quality evaluation packet",
    canonicalOwner: "rpQualityEvaluationPacket.buildQualityOutputPacket",
    effectiveValueSource: "existing rubric / hard gates / authoring notes",
    scope: "GPT/human scoring container",
    otherReaders: ["this PRECALL paired comparison"],
    duplicateOrStaleOwner: "do not add a second rubric owner",
  },
  {
    responsibility: "response length",
    canonicalOwner:
      "responseLengthConstants.UNIFIED_TIER_AIM_CHARS + openRouterClient.resolveOpenRouterMaxTokens + responseLength.resolveStreamCharCap",
    effectiveValueSource:
      "soft aim 3200+; application max_tokens undefined; stream cap MAX_SAFE_INTEGER",
    scope: "Main RP generation — not UI edit",
    otherReaders: ["rpQualityBaseline length class (3500 = center-band metadata, not a cap)"],
    duplicateOrStaleOwner:
      "ASSISTANT_MESSAGE_EDIT_MAX_CHARS=5000 is UI manual-edit only",
  },
  {
    responsibility: "production parity gate for quality scores",
    canonicalOwner: "scripts/lib/rpMainRpStyleLengthGolden.evaluateOwnedProductionRequestParity",
    effectiveValueSource:
      "reloadMainRpStyleLengthGolden + loadPrecallProductionRows + assemblePrecallFinalWireWithSealedRequests",
    scope:
      "fail-closed quality-score eligibility; PRECALL_READY and paid auth stay separate",
    otherReaders: [
      "scripts/lib/openscaleDeepseekV41FlashRpPilot (first consumer)",
      "FOLLOW-UP: rpQualityPrecall / rpQualityPaidRunner / rpActiveModelQualityLive",
    ],
    duplicateOrStaleOwner: "do not copy this gate into each runner",
  },
];

export type RpQualityPrecallModelPlan = {
  canonicalId: SelectedAI;
  displayLabel: string;
  provider: ReturnType<typeof selectedAIProvider>;
  wireModel: string;
};

export const RP_QUALITY_PRECALL_FIXTURE_STIMULUS = Object.freeze({
  A_relationship_emotion: "quiet_window_safe",
  B_conflict_action_spatial: "conflict_action_spatial_safe",
  C_continuity_progression: "relationship_turn_safe",
} as const);

export type RpQualityPrecallStimulusId =
  (typeof RP_QUALITY_PRECALL_FIXTURE_STIMULUS)[RpQualityPrecallFixtureId];

export type RpQualityPrecallFixtureSpec = {
  id: RpQualityPrecallFixtureId;
  turnKind: RpQualityTurnKind;
  contentMode: RpQualityContentMode;
  authoringLevel: typeof DEFAULT_USER_AUTHORING_LEVEL;
  evaluationFocus: readonly string[];
  historyOwner: typeof PRECALL_GREETING_STIMULUS_OWNER;
  stimulusOwner: typeof PRECALL_SCENE_SEED_OWNER;
  stimulusId: RpQualityPrecallStimulusId;
  memoryCanonSource: "none_for_this_pilot";
  sceneControl: "production_default";
  targetLengthOwner: "UNIFIED_TIER_AIM_CHARS";
  notes: string;
};

export type RpQualityPrecallPlannedSemanticInput = {
  fixtureId: RpQualityPrecallFixtureId;
  characterId: number;
  characterName: string;
  personaName: string;
  authoringLevel: typeof DEFAULT_USER_AUTHORING_LEVEL;
  contentMode: RpQualityContentMode;
  historyOwner: typeof PRECALL_GREETING_STIMULUS_OWNER;
  stimulusOwner: typeof PRECALL_SCENE_SEED_OWNER;
  stimulusId: RpQualityPrecallStimulusId;
  memoryCanonSource: RpQualityPrecallFixtureSpec["memoryCanonSource"];
  sceneControl: RpQualityPrecallFixtureSpec["sceneControl"];
  targetLengthOwner: RpQualityPrecallFixtureSpec["targetLengthOwner"];
  turnKind: RpQualityTurnKind;
  liveRowReconfirmed: false;
};

export type RpQualityPrecallAdapterDiff = {
  canonicalId: SelectedAI;
  provider: RpQualityPrecallModelPlan["provider"];
  wireModel: string;
  routePolicyOwned: boolean;
};

export type RpQualityPrecallSamplePlan = {
  fixtureId: RpQualityPrecallFixtureId;
  model: RpQualityPrecallModelPlan;
  /** Plan-template parity only. Not production history / final-wire parity. */
  plannedSemanticFingerprint: string;
  adapterFingerprint: string;
  targetResponseChars: number;
  applicationMaxTokens: undefined;
  streamCharCap: number;
  uiEditMaxChars: number;
  retry: 0;
  fallback: 0;
  auxiliary: 0;
};

export const RP_QUALITY_PRECALL_LIVE_PROOF_STATUSES = [
  "NOT_PROVIDED",
  "UNVERIFIED",
  "VERIFIED",
] as const;
export type RpQualityPrecallLiveProofStatus =
  (typeof RP_QUALITY_PRECALL_LIVE_PROOF_STATUSES)[number];

export type RpQualityPrecallLiveProofInput = {
  source: string;
  generatedAt: string;
  deployedGitSha: string;
  characterId: number;
  characterName: string;
  greetingSha256: string;
  systemPromptSha256: string;
  worldSha256: string;
  settingChunksSha256: string;
  personaName: string;
  personaPublicSha256: string;
  authoringLevel: UserAuthoringLevel;
  contentMode: RpQualityContentMode;
  personaId?: number;
  personaGender?: string;
  personaPublicChars?: number;
};

export type RpQualityPrecallLiveProof =
  | { status: "NOT_PROVIDED" }
  | {
      status: "UNVERIFIED";
      input: RpQualityPrecallLiveProofInput;
      reasons: readonly string[];
    }
  | { status: "VERIFIED"; input: RpQualityPrecallLiveProofInput };

export type RpQualityPrecallCostBound = {
  status: "UNCOMPUTED";
  approvedBoundUsd: null;
  approvedBoundKrw: null;
  perCallEstimatedUpperUsd: null;
  perModelThreeCallBoundUsd: null;
  totalTwelveCallBoundUsd: null;
  providerCurrencyAssumptions: {
    catalogOwner: "publishedModelPricing.getPublishedPricing";
    cacheAssumption: "uncached_upper_bound_if_computed_later";
    outputAssumption: "no_production_max_tokens_ceiling_do_not_invent_cap";
    fx: "KRW not approved; USD provider catalog only";
  };
  catalogRatesUsdPerMillion: readonly {
    canonicalId: SelectedAI;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }[];
  reason: string;
};

export type RpQualityPrecallPairPreference = "A_preferred" | "B_preferred" | "tie" | null;

export type RpQualityPrecallPairSlot = {
  fixtureId: RpQualityPrecallFixtureId;
  pairId: string;
  opaqueA: string;
  opaqueB: string;
  reveal: {
    A: { canonicalId: SelectedAI; displayLabel: string };
    B: { canonicalId: SelectedAI; displayLabel: string };
  };
  overall: RpQualityPrecallPairPreference;
  dimensionPreferences: Record<string, RpQualityPrecallPairPreference>;
};

export type RpQualityPrecallStartDenial = {
  started: false;
  paidExecutionStatus: typeof RP_QUALITY_PRECALL_PAID_STATUS;
  providerPosts: 0;
  reason:
    | "MISSING_VERIFIED_LIVE_PROOF"
    | "MISSING_APPROVED_COST_BOUND"
    | "NOT_AUTHORIZED_PRECALL_ONLY"
    | "PRECALL_OWNER_DOES_NOT_EXECUTE";
};

export type RpQualityPrecallReportInput = {
  liveProofInput?: RpQualityPrecallLiveProofInput;
  expectedDeploySha?: string;
  approvedCostBoundUsd?: number | null;
  approvedCostBoundKrw?: number | null;
  paidExecutionAuthorized?: boolean;
};

export type RpQualityPrecallReport = {
  version: typeof RP_QUALITY_PRECALL_VERSION;
  classification: RpQualityPrecallClassification;
  precallReady: boolean;
  readinessScope: typeof RP_QUALITY_PRECALL_READINESS_SCOPE;
  paidExecutionStatus: typeof RP_QUALITY_PRECALL_PAID_STATUS;
  providerPosts: 0;
  plannedCalls: typeof RP_QUALITY_PRECALL_PLANNED_CALLS;
  executionPolicy: typeof RP_QUALITY_PRECALL_EXECUTION_POLICY;
  mutationPolicy: typeof RP_QUALITY_PRECALL_MUTATION_POLICY;
  ownerMap: readonly RpQualityPrecallOwnerRow[];
  models: readonly RpQualityPrecallModelPlan[];
  fixtures: readonly RpQualityPrecallFixtureSpec[];
  plan: readonly RpQualityPrecallSamplePlan[];
  plannedSemanticParityOnly: true;
  threeFixtureConcreteStimulusReady: boolean;
  twelveCallConcreteStimulusReady: boolean;
  concreteStimulus: Record<
    RpQualityPrecallFixtureId,
    { stimulusId: RpQualityPrecallStimulusId; stimulusReady: boolean }
  >;
  liveProof: RpQualityPrecallLiveProof;
  authoring: {
    level: typeof DEFAULT_USER_AUTHORING_LEVEL;
    capabilities: ReturnType<typeof capabilitiesFromUserAuthoringLevel>;
    evaluationNotes: readonly string[];
    matrix: ReturnType<typeof liveAuthoringCapabilityMatrix>;
  };
  length: {
    softAimChars: number;
    applicationMaxTokens: undefined;
    streamCharCap: number;
    centerBandMaxIsMetadataNotCap: number;
    uiEditMaxChars: number;
    longOkClass: ReturnType<typeof classifyVisibleLength>;
  };
  cost: RpQualityPrecallCostBound;
  evaluationContract: ReturnType<typeof buildQualityEvaluationContract>;
  plannedPackets: readonly RpQualityOutputPacket[];
  pairedComparisons: readonly RpQualityPrecallPairSlot[];
  adultPilot: "SEPARATE_FOLLOW_UP";
  notes: readonly string[];
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const FULL_GIT_SHA_RE = /^[a-f0-9]{40}$/i;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function absentLiveProof(): Extract<RpQualityPrecallLiveProof, { status: "NOT_PROVIDED" }> {
  return { status: "NOT_PROVIDED" };
}

export function historicalRowProofCannotSatisfyCurrent(input: RpQualityPrecallLiveProofInput): boolean {
  const source = input.source.trim();
  const deploy = input.deployedGitSha.trim().toLowerCase();
  return (
    source === HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_OWNER ||
    deploy === HISTORICAL_LIVE_DEPLOYED_ROW_PROOF_COMMIT
  );
}

export function isParseableIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_RE.test(value.trim())) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function isFullGitSha(value: string): boolean {
  return FULL_GIT_SHA_RE.test(value.trim());
}

export function validateLiveProof(
  input: RpQualityPrecallLiveProofInput | undefined,
  opts?: { expectedDeploySha?: string }
): RpQualityPrecallLiveProof {
  if (!input) return absentLiveProof();
  const reasons: string[] = [];
  const source = requiredText(input.source);
  const generatedAt = requiredText(input.generatedAt);
  const deployedGitSha = requiredText(input.deployedGitSha);
  const characterName = requiredText(input.characterName);
  const personaName = requiredText(input.personaName);
  if (!source) reasons.push("missing_source");
  if (!generatedAt) reasons.push("missing_generatedAt");
  else if (!isParseableIsoTimestamp(generatedAt)) reasons.push("invalid_generatedAt");
  if (!deployedGitSha) reasons.push("missing_deployedGitSha");
  else if (!isFullGitSha(deployedGitSha)) reasons.push("invalid_deployedGitSha");
  if (input.characterId !== RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId) {
    reasons.push("characterId_does_not_match_target_selector");
  }
  if (characterName !== RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName) {
    reasons.push("characterName_does_not_match_target_selector");
  }
  if (!personaName) reasons.push("missing_personaName");
  else if (personaName !== RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName) {
    reasons.push("personaName_does_not_match_target_selector");
  }
  for (const field of [
    "greetingSha256",
    "systemPromptSha256",
    "worldSha256",
    "settingChunksSha256",
    "personaPublicSha256",
  ] as const) {
    if (!SHA256_HEX_RE.test(String(input[field] ?? ""))) reasons.push(`invalid_${field}`);
  }
  if (
    input.authoringLevel !== "LIMITED" &&
    input.authoringLevel !== "NORMAL" &&
    input.authoringLevel !== "ALLOW"
  ) {
    reasons.push("invalid_authoringLevel");
  }
  if (input.contentMode !== "SAFE" && input.contentMode !== "19+") {
    reasons.push("invalid_contentMode");
  }
  if (historicalRowProofCannotSatisfyCurrent(input)) {
    reasons.push("historical_LIVE_DEPLOYED_ROW_PROOF_cannot_auto_satisfy");
  }
  const expected = requiredText(opts?.expectedDeploySha);
  if (!expected) {
    reasons.push("missing_expectedDeploySha");
  } else if (!isFullGitSha(expected)) {
    reasons.push("invalid_expectedDeploySha");
  } else if (deployedGitSha && deployedGitSha.toLowerCase() !== expected.toLowerCase()) {
    reasons.push("deployedGitSha_does_not_match_expected");
  }
  if (reasons.length > 0) {
    return { status: "UNVERIFIED", input, reasons };
  }
  return { status: "VERIFIED", input };
}

export function mappedFixtureStimulus(
  fixtureId: RpQualityPrecallFixtureId
): {
  historyOwner: typeof PRECALL_GREETING_STIMULUS_OWNER;
  stimulusOwner: typeof PRECALL_SCENE_SEED_OWNER;
  stimulusId: RpQualityPrecallStimulusId;
} {
  return {
    historyOwner: PRECALL_GREETING_STIMULUS_OWNER,
    stimulusOwner: PRECALL_SCENE_SEED_OWNER,
    stimulusId: RP_QUALITY_PRECALL_FIXTURE_STIMULUS[fixtureId],
  };
}

export function concreteStimulusReadiness(
  mapping: typeof RP_QUALITY_PRECALL_FIXTURE_STIMULUS = RP_QUALITY_PRECALL_FIXTURE_STIMULUS
): {
  threeFixtureConcreteStimulusReady: boolean;
  twelveCallConcreteStimulusReady: boolean;
  concreteStimulus: RpQualityPrecallReport["concreteStimulus"];
} {
  const concreteStimulus = {
    A_relationship_emotion: {
      stimulusId: mapping.A_relationship_emotion,
      stimulusReady: mapping.A_relationship_emotion != null,
    },
    B_conflict_action_spatial: {
      stimulusId: mapping.B_conflict_action_spatial,
      stimulusReady: mapping.B_conflict_action_spatial != null,
    },
    C_continuity_progression: {
      stimulusId: mapping.C_continuity_progression,
      stimulusReady: mapping.C_continuity_progression != null,
    },
  };
  const threeFixtureConcreteStimulusReady = RP_QUALITY_PRECALL_FIXTURE_IDS.every(
    (id) => mapping[id] != null
  );
  return {
    threeFixtureConcreteStimulusReady,
    twelveCallConcreteStimulusReady: threeFixtureConcreteStimulusReady,
    concreteStimulus,
  };
}

export function classifyPrecallReport(
  liveProof: RpQualityPrecallLiveProof,
  threeFixtureConcreteStimulusReady: boolean
): { classification: RpQualityPrecallClassification; precallReady: boolean } {
  if (liveProof.status === "VERIFIED" && threeFixtureConcreteStimulusReady) {
    return { classification: "PRECALL_READY", precallReady: true };
  }
  return { classification: "NOT_REPRODUCIBLE", precallReady: false };
}

export function hasApprovedCostBound(input?: {
  approvedCostBoundUsd?: number | null;
  approvedCostBoundKrw?: number | null;
}): boolean {
  return input?.approvedCostBoundUsd != null || input?.approvedCostBoundKrw != null;
}

export function rpQualityPrecallBenchmarkModels(): readonly RpQualityPrecallModelPlan[] {
  return MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => ({
    canonicalId: option.id,
    displayLabel: option.label,
    provider: selectedAIProvider(option.id),
    wireModel: resolveMainRpPrimaryWireModelId(option.id),
  }));
}

export function assertActiveMainRpBenchmarkSet(
  models: readonly RpQualityPrecallModelPlan[] = rpQualityPrecallBenchmarkModels()
): void {
  if (models.length !== MAIN_RP_USER_SELECTABLE_OPTIONS.length) {
    throw new Error(
      `PRECALL model count drifted from MAIN_RP_USER_SELECTABLE_OPTIONS: ${models.length}`
    );
  }
  if (models.length !== 4) {
    throw new Error(`Expected 4 active Main RP models, got ${models.length}`);
  }
  const ids = models.map((row) => row.canonicalId);
  if (JSON.stringify(ids) !== JSON.stringify([...MAIN_RP_MODEL_IDS])) {
    throw new Error("PRECALL model set is not MAIN_RP_MODEL_IDS");
  }
  const labels = models.map((row) => row.displayLabel);
  const registryLabels = MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.label);
  if (JSON.stringify(labels) !== JSON.stringify(registryLabels)) {
    throw new Error("PRECALL labels are not MAIN_RP_USER_SELECTABLE_OPTIONS labels");
  }
  const retiredIds = [
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  ];
  for (const retiredId of retiredIds) {
    if (ids.includes(retiredId as SelectedAI)) {
      throw new Error(`Retired Gemini present in PRECALL set: ${retiredId}`);
    }
  }
  for (const retiredLabel of [
    GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
    GEMINI_37_FLASH_DISPLAY_NAME,
  ]) {
    if (labels.includes(retiredLabel)) {
      throw new Error(`Retired Gemini present in PRECALL set: ${retiredLabel}`);
    }
  }
}

export function rpQualityPrecallFixtures(): readonly RpQualityPrecallFixtureSpec[] {
  return [
    {
      id: "A_relationship_emotion",
      turnKind: "manual",
      contentMode: "SAFE",
      authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
      evaluationFocus: [
        "character_voice",
        "natural_korean",
        "psychology_emotion",
        "dialogue_pacing",
        "subtle_relationship_movement",
        "repetition_control",
      ],
      ...mappedFixtureStimulus("A_relationship_emotion"),
      memoryCanonSource: "none_for_this_pilot",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Reuses COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.quiet_window_safe. History opening is the current greeting via buildGreetingBodyCueReviewCases.",
    },
    {
      id: "B_conflict_action_spatial",
      turnKind: "manual",
      contentMode: "SAFE",
      authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
      evaluationFocus: [
        "forward_motion",
        "environment_grounding",
        "physical_spatial_continuity",
        "concrete_action",
        "ai_initiative",
        "scene_stalled_in_place",
        "character_voice",
      ],
      ...mappedFixtureStimulus("B_conflict_action_spatial"),
      memoryCanonSource: "none_for_this_pilot",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Reuses COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.conflict_action_spatial_safe. History opening is the current greeting via buildGreetingBodyCueReviewCases. B16 is design reference only and is not this stimulus.",
    },
    {
      id: "C_continuity_progression",
      turnKind: "manual",
      contentMode: "SAFE",
      authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
      evaluationFocus: [
        "prior_turn_callback",
        "relationship_state_continuity",
        "meaningful_scene_change",
        "repetition_across_turns",
        "ai_cast_no_initiative_always_waits",
      ],
      ...mappedFixtureStimulus("C_continuity_progression"),
      memoryCanonSource: "none_for_this_pilot",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Reuses COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.relationship_turn_safe after the same current greeting. Ordinary path, not auto-progress.",
    },
  ];
}

export function plannedFixtureSemanticInput(
  fixture: RpQualityPrecallFixtureSpec
): RpQualityPrecallPlannedSemanticInput {
  return {
    fixtureId: fixture.id,
    characterId: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId,
    characterName: RP_QUALITY_PRECALL_TARGET_SELECTOR.characterName,
    personaName: RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName,
    authoringLevel: fixture.authoringLevel,
    contentMode: fixture.contentMode,
    historyOwner: fixture.historyOwner,
    stimulusOwner: fixture.stimulusOwner,
    stimulusId: fixture.stimulusId,
    memoryCanonSource: fixture.memoryCanonSource,
    sceneControl: fixture.sceneControl,
    targetLengthOwner: fixture.targetLengthOwner,
    turnKind: fixture.turnKind,
    liveRowReconfirmed: false,
  };
}

export function plannedSemanticInputFingerprint(
  input: RpQualityPrecallPlannedSemanticInput
): string {
  return sha256Json(input);
}

export function adapterDiffFingerprint(diff: RpQualityPrecallAdapterDiff): string {
  return sha256Json(diff);
}

export function buildRpQualityPrecallPlan(): RpQualityPrecallSamplePlan[] {
  const models = rpQualityPrecallBenchmarkModels();
  assertActiveMainRpBenchmarkSet(models);
  const fixtures = rpQualityPrecallFixtures();
  const plan = models.flatMap((model) =>
    fixtures.map((fixture) => {
      const semantic = plannedFixtureSemanticInput(fixture);
      const adapter: RpQualityPrecallAdapterDiff = {
        canonicalId: model.canonicalId,
        provider: model.provider,
        wireModel: model.wireModel,
        routePolicyOwned: model.provider === "openrouter",
      };
      const applicationMaxTokens = resolveOpenRouterMaxTokens(
        UNIFIED_TIER_AIM_CHARS,
        undefined,
        model.wireModel
      );
      if (applicationMaxTokens !== undefined) {
        throw new Error("PRECALL must not introduce an application max_tokens ceiling");
      }
      return {
        fixtureId: fixture.id,
        model,
        plannedSemanticFingerprint: plannedSemanticInputFingerprint(semantic),
        adapterFingerprint: adapterDiffFingerprint(adapter),
        targetResponseChars: UNIFIED_TIER_AIM_CHARS,
        applicationMaxTokens,
        streamCharCap: resolveStreamCharCap(UNIFIED_TIER_AIM_CHARS),
        uiEditMaxChars: ASSISTANT_MESSAGE_EDIT_MAX_CHARS as number,
        retry: 0 as const,
        fallback: 0 as const,
        auxiliary: 0 as const,
      };
    })
  );
  if (plan.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    throw new Error(`PRECALL plan must be 12 samples, got ${plan.length}`);
  }
  return plan;
}

export function assertFixturePlannedSemanticParity(
  plan: readonly RpQualityPrecallSamplePlan[] = buildRpQualityPrecallPlan()
): void {
  for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
    const rows = plan.filter((row) => row.fixtureId === fixtureId);
    if (rows.length !== 4) {
      throw new Error(`${fixtureId} must have exactly 4 model rows`);
    }
    const semantic = new Set(rows.map((row) => row.plannedSemanticFingerprint));
    if (semantic.size !== 1) {
      throw new Error(`${fixtureId} planned semantic inputs are not identical across models`);
    }
    const adapters = new Set(rows.map((row) => row.adapterFingerprint));
    if (adapters.size !== 4) {
      throw new Error(`${fixtureId} adapter fingerprints must differ per model`);
    }
    const aims = new Set(rows.map((row) => row.targetResponseChars));
    if (aims.size !== 1 || !aims.has(UNIFIED_TIER_AIM_CHARS)) {
      throw new Error(`${fixtureId} length owner drifted`);
    }
    if (rows.some((row) => row.applicationMaxTokens !== undefined)) {
      throw new Error(`${fixtureId} introduced an application max_tokens ceiling`);
    }
    if (rows.some((row) => row.retry !== 0 || row.fallback !== 0 || row.auxiliary !== 0)) {
      throw new Error(`${fixtureId} retry/fallback/auxiliary is not zero`);
    }
  }
}

export function evaluateRpQualityPrecallCostBound(): RpQualityPrecallCostBound {
  const catalogRatesUsdPerMillion = rpQualityPrecallBenchmarkModels().map((model) => {
    const pricing = getPublishedPricing(model.canonicalId);
    return {
      canonicalId: model.canonicalId,
      inputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
    };
  });
  return {
    status: "UNCOMPUTED",
    approvedBoundUsd: null,
    approvedBoundKrw: null,
    perCallEstimatedUpperUsd: null,
    perModelThreeCallBoundUsd: null,
    totalTwelveCallBoundUsd: null,
    providerCurrencyAssumptions: {
      catalogOwner: "publishedModelPricing.getPublishedPricing",
      cacheAssumption: "uncached_upper_bound_if_computed_later",
      outputAssumption: "no_production_max_tokens_ceiling_do_not_invent_cap",
      fx: "KRW not approved; USD provider catalog only",
    },
    catalogRatesUsdPerMillion,
    reason:
      "Production assembled input size is unavailable until a verified live proof is injected. Catalog rates are recorded as assumptions only. No USD/KRW bound is invented or approved.",
  };
}

export type RpQualityPrecallSizeRow = {
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  totalInputChars: number;
  estimatedInputTokens: number;
  systemChars: number;
  systemEstimatedTokens: number;
  currentUserTurnChars: number;
  historyMessageCount: number;
  tokenEstimator: "ceil(chars * 0.9)";
  providerCountedTokens: null;
};

export type RpQualityPrecallFxSnapshotRow = {
  date_key: string;
  base_usd_krw: number;
  source: string;
  fetched_at: string;
} | null;

export type RpQualityPrecallFxPlanning =
  | {
      status: "VERIFIED";
      owner: "billing_fx_daily_snapshots + billingFxPolicy.applyOverseasCardFee";
      dateKey: string;
      fetchedAt: string;
      snapshotSource: "api_daily" | "previous_daily_snapshot";
      baseUsdKrw: number;
      overseasCardFeePercent: number;
      effectiveKrwPerUsd: number;
    }
  | {
      status: "UNVERIFIED";
      owner: "billing_fx_daily_snapshots + billingFxPolicy.applyOverseasCardFee";
      reason: string;
    };

export const RP_QUALITY_PRECALL_OUTPUT_SCENARIOS = Object.freeze([
  { id: "aim_3200_plus", outputChars: UNIFIED_TIER_AIM_CHARS },
  { id: "long_sensitivity_2x", outputChars: UNIFIED_TIER_AIM_CHARS * 2 },
] as const);
export type RpQualityPrecallOutputScenarioId =
  (typeof RP_QUALITY_PRECALL_OUTPUT_SCENARIOS)[number]["id"];

export type RpQualityPrecallCostPlanningCall = {
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  scenarioId: RpQualityPrecallOutputScenarioId;
  inputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  longContextApplied: boolean;
  uncachedInputUsd: number;
  outputUsd: number;
  providerUsd: number;
  inputUsdIfFullyCacheWritten: number | null;
  providerKrw: number | null;
};

export type RpQualityPrecallCostPlanningModelTotal = {
  canonicalId: SelectedAI;
  scenarioId: RpQualityPrecallOutputScenarioId;
  calls: number;
  providerUsd: number;
  providerKrw: number | null;
  estimatedUserChargeKrw: number | null;
  targetMargin: number;
};

export type RpQualityPrecallCostPlanningAggregate = {
  scenarioId: RpQualityPrecallOutputScenarioId;
  calls: number;
  providerUsd: number;
  providerKrw: number | null;
  estimatedUserChargeKrw: number | null;
};

export type RpQualityPrecallCostPlanning = {
  status: "PLANNING_ONLY_NOT_APPROVED";
  fx: RpQualityPrecallFxPlanning;
  inputAssumption: "uncached_local_estimate_not_provider_counted";
  outputScenarios: typeof RP_QUALITY_PRECALL_OUTPUT_SCENARIOS;
  reasoningTokensIncluded: false;
  calls: readonly RpQualityPrecallCostPlanningCall[];
  perModel: readonly RpQualityPrecallCostPlanningModelTotal[];
  aggregate: readonly RpQualityPrecallCostPlanningAggregate[];
  separation: {
    providerCost: "providerUsd / providerKrw";
    estimatedUserCharge: "providerKrw / (1 - targetMargin); not a billing ledger entry; promo and minimum floors not applied";
    approvalBudget: {
      status: "NOT_APPROVED";
      approvedBoundUsd: null;
      approvedBoundKrw: null;
    };
  };
  maxSingleCallExposure: {
    status: "UNKNOWN";
    reason: string;
  };
  outputCostLimitation: string;
};

export const RP_QUALITY_PRECALL_OUTPUT_COST_LIMITATION =
  "Production sends no application max_tokens, and PRECALL must not add one. Output tokens are therefore a planning scenario, not a ceiling: a single call can exceed every figure here. Reasoning/thinking tokens are billed as output and are not included. Token counts are the repo's local ceil(chars*0.9) estimate, not provider-counted.";

export function planRpQualityPrecallFx(
  row: RpQualityPrecallFxSnapshotRow
): RpQualityPrecallFxPlanning {
  const owner = "billing_fx_daily_snapshots + billingFxPolicy.applyOverseasCardFee" as const;
  if (!row) return { status: "UNVERIFIED", owner, reason: "no_fx_snapshot_row" };
  if (row.source !== "api_daily" && row.source !== "previous_daily_snapshot") {
    return { status: "UNVERIFIED", owner, reason: `fx_snapshot_source_${row.source}_not_verified` };
  }
  if (!Number.isFinite(row.base_usd_krw) || row.base_usd_krw <= 0) {
    return { status: "UNVERIFIED", owner, reason: "fx_snapshot_rate_invalid" };
  }
  if (!Number.isFinite(Date.parse(row.fetched_at))) {
    return { status: "UNVERIFIED", owner, reason: "fx_snapshot_fetched_at_invalid" };
  }
  return {
    status: "VERIFIED",
    owner,
    dateKey: row.date_key,
    fetchedAt: row.fetched_at,
    snapshotSource: row.source,
    baseUsdKrw: row.base_usd_krw,
    overseasCardFeePercent: OVERSEAS_CARD_FEE_PERCENT,
    effectiveKrwPerUsd: applyOverseasCardFee(row.base_usd_krw),
  };
}

export function computeRpQualityPrecallCostPlanning(input: {
  sizeRows: readonly RpQualityPrecallSizeRow[];
  fxRow: RpQualityPrecallFxSnapshotRow;
}): RpQualityPrecallCostPlanning {
  if (input.sizeRows.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    throw new Error(`cost planning needs ${RP_QUALITY_PRECALL_PLANNED_CALLS} size rows`);
  }
  const fx = planRpQualityPrecallFx(input.fxRow);
  const krwPerUsd = fx.status === "VERIFIED" ? fx.effectiveKrwPerUsd : null;
  const calls: RpQualityPrecallCostPlanningCall[] = [];
  for (const scenario of RP_QUALITY_PRECALL_OUTPUT_SCENARIOS) {
    for (const row of input.sizeRows) {
      const pricing = getPublishedPricing(row.canonicalId);
      const rates = resolvePublishedReferenceRatesForPrompt(pricing, row.estimatedInputTokens);
      const outputTokens = estimateTokensFromCharCount(scenario.outputChars);
      const uncachedInputUsd = (row.estimatedInputTokens / 1_000_000) * rates.inputUsdPerMillion;
      const outputUsd = (outputTokens / 1_000_000) * rates.outputUsdPerMillion;
      const providerUsd = uncachedInputUsd + outputUsd;
      calls.push({
        fixtureId: row.fixtureId,
        canonicalId: row.canonicalId,
        scenarioId: scenario.id,
        inputTokens: row.estimatedInputTokens,
        outputTokens,
        inputUsdPerMillion: rates.inputUsdPerMillion,
        outputUsdPerMillion: rates.outputUsdPerMillion,
        longContextApplied: rates.longContextApplied,
        uncachedInputUsd,
        outputUsd,
        providerUsd,
        inputUsdIfFullyCacheWritten:
          rates.cacheWriteUsdPerMillion != null
            ? (row.estimatedInputTokens / 1_000_000) * rates.cacheWriteUsdPerMillion
            : null,
        providerKrw: krwPerUsd == null ? null : providerUsd * krwPerUsd,
      });
    }
  }
  const modelIds = [...new Set(input.sizeRows.map((row) => row.canonicalId))];
  const perModel: RpQualityPrecallCostPlanningModelTotal[] = [];
  for (const scenario of RP_QUALITY_PRECALL_OUTPUT_SCENARIOS) {
    for (const canonicalId of modelIds) {
      const rows = calls.filter(
        (call) => call.canonicalId === canonicalId && call.scenarioId === scenario.id
      );
      const providerUsd = rows.reduce((sum, call) => sum + call.providerUsd, 0);
      const providerKrw = krwPerUsd == null ? null : providerUsd * krwPerUsd;
      const targetMargin = getPublishedPricing(canonicalId).targetMargin;
      perModel.push({
        canonicalId,
        scenarioId: scenario.id,
        calls: rows.length,
        providerUsd,
        providerKrw,
        estimatedUserChargeKrw: providerKrw == null ? null : providerKrw / (1 - targetMargin),
        targetMargin,
      });
    }
  }
  const aggregate: RpQualityPrecallCostPlanningAggregate[] = RP_QUALITY_PRECALL_OUTPUT_SCENARIOS.map(
    (scenario) => {
      const rows = perModel.filter((row) => row.scenarioId === scenario.id);
      const providerUsd = rows.reduce((sum, row) => sum + row.providerUsd, 0);
      const userCharges = rows.map((row) => row.estimatedUserChargeKrw);
      return {
        scenarioId: scenario.id,
        calls: rows.reduce((sum, row) => sum + row.calls, 0),
        providerUsd,
        providerKrw: krwPerUsd == null ? null : providerUsd * krwPerUsd,
        estimatedUserChargeKrw: userCharges.every((value): value is number => value != null)
          ? userCharges.reduce((sum, value) => sum + value, 0)
          : null,
      };
    }
  );
  return {
    status: "PLANNING_ONLY_NOT_APPROVED",
    fx,
    inputAssumption: "uncached_local_estimate_not_provider_counted",
    outputScenarios: RP_QUALITY_PRECALL_OUTPUT_SCENARIOS,
    reasoningTokensIncluded: false,
    calls,
    perModel,
    aggregate,
    separation: {
      providerCost: "providerUsd / providerKrw",
      estimatedUserCharge:
        "providerKrw / (1 - targetMargin); not a billing ledger entry; promo and minimum floors not applied",
      approvalBudget: { status: "NOT_APPROVED", approvedBoundUsd: null, approvedBoundKrw: null },
    },
    maxSingleCallExposure: {
      status: "UNKNOWN",
      reason:
        "No application max_tokens ceiling exists and none may be added by PRECALL; any estimate is non-enforceable.",
    },
    outputCostLimitation: RP_QUALITY_PRECALL_OUTPUT_COST_LIMITATION,
  };
}

export function buildPlannedQualityPackets(
  plan: readonly RpQualityPrecallSamplePlan[] = buildRpQualityPrecallPlan()
): RpQualityOutputPacket[] {
  const fixtures = new Map(rpQualityPrecallFixtures().map((row) => [row.id, row]));
  return plan.map((sample, index) => {
    const fixture = fixtures.get(sample.fixtureId);
    if (!fixture) throw new Error(`Missing fixture ${sample.fixtureId}`);
    return buildQualityOutputPacket({
      opaqueLabel: `PRECALL-${sample.fixtureId}-${sample.model.canonicalId}-${index + 1}`,
      generatedText: "",
      model: sample.model.displayLabel,
      sceneClass: sample.fixtureId,
      authoringLevel: fixture.authoringLevel,
      turnKind: fixture.turnKind,
      contentMode: fixture.contentMode,
      finishReason: null,
      finalWireFingerprint: null,
    });
  });
}

export function buildPairedComparisonPackets(
  plan: readonly RpQualityPrecallSamplePlan[] = buildRpQualityPrecallPlan()
): RpQualityPrecallPairSlot[] {
  const slots: RpQualityPrecallPairSlot[] = [];
  for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
    const models = plan
      .filter((row) => row.fixtureId === fixtureId)
      .map((row) => row.model);
    for (let i = 0; i < models.length; i += 1) {
      for (let j = i + 1; j < models.length; j += 1) {
        const left = models[i]!;
        const right = models[j]!;
        slots.push({
          fixtureId,
          pairId: `${fixtureId}:${left.canonicalId}__${right.canonicalId}`,
          opaqueA: `P-${fixtureId}-A-${slots.length + 1}`,
          opaqueB: `P-${fixtureId}-B-${slots.length + 1}`,
          reveal: {
            A: { canonicalId: left.canonicalId, displayLabel: left.displayLabel },
            B: { canonicalId: right.canonicalId, displayLabel: right.displayLabel },
          },
          overall: null,
          dimensionPreferences: {},
        });
      }
    }
  }
  return slots;
}

const SECRET_LEAK_RE =
  /sk-[a-zA-Z0-9]{10,}|Bearer\s+[A-Za-z0-9._\-]+|OPENROUTER_API_KEY\s*=\s*\S+|CHEAPER_INFERENCE_API_KEY\s*=\s*\S+|OPENAI_API_KEY\s*=\s*\S+|authorization["']?\s*:\s*["']?Bearer/i;

export function stringContainsSecretShape(text: string): boolean {
  return SECRET_LEAK_RE.test(text);
}

export function artifactContainsSecret(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return stringContainsSecretShape(value);
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some(artifactContainsSecret);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
      if (/api[_-]?key|authorization|secret|token|password/i.test(key) && nested) {
        return true;
      }
      return artifactContainsSecret(nested);
    });
  }
  return false;
}

function deny(
  reason: RpQualityPrecallStartDenial["reason"]
): RpQualityPrecallStartDenial {
  return {
    started: false,
    paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
    providerPosts: 0,
    reason,
  };
}

export function startRpQualityPrecallPaidExecution(
  input?: RpQualityPrecallReportInput & { liveProof?: RpQualityPrecallLiveProof }
): RpQualityPrecallStartDenial {
  const liveProof =
    input?.liveProof ??
    validateLiveProof(input?.liveProofInput, {
      expectedDeploySha: input?.expectedDeploySha,
    });
  if (liveProof.status !== "VERIFIED") {
    return deny("MISSING_VERIFIED_LIVE_PROOF");
  }
  if (!hasApprovedCostBound(input)) {
    return deny("MISSING_APPROVED_COST_BOUND");
  }
  if (input?.paidExecutionAuthorized !== true) {
    return deny("NOT_AUTHORIZED_PRECALL_ONLY");
  }
  return deny("PRECALL_OWNER_DOES_NOT_EXECUTE");
}

export function buildRpQualityPrecallReport(
  input?: RpQualityPrecallReportInput
): RpQualityPrecallReport {
  const models = rpQualityPrecallBenchmarkModels();
  assertActiveMainRpBenchmarkSet(models);
  const fixtures = rpQualityPrecallFixtures();
  const plan = buildRpQualityPrecallPlan();
  assertFixturePlannedSemanticParity(plan);
  const liveProof = validateLiveProof(input?.liveProofInput, {
    expectedDeploySha: input?.expectedDeploySha,
  });
  const stimulus = concreteStimulusReadiness();
  const classified = classifyPrecallReport(
    liveProof,
    stimulus.threeFixtureConcreteStimulusReady
  );
  const cost = evaluateRpQualityPrecallCostBound();
  const plannedPackets = buildPlannedQualityPackets(plan);
  const pairedComparisons = buildPairedComparisonPackets(plan);
  const contract = buildQualityEvaluationContract();
  return {
    version: RP_QUALITY_PRECALL_VERSION,
    classification: classified.classification,
    precallReady: classified.precallReady,
    readinessScope: RP_QUALITY_PRECALL_READINESS_SCOPE,
    paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
    providerPosts: 0,
    plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
    executionPolicy: RP_QUALITY_PRECALL_EXECUTION_POLICY,
    mutationPolicy: RP_QUALITY_PRECALL_MUTATION_POLICY,
    ownerMap: RP_QUALITY_PRECALL_OWNER_MAP,
    models,
    fixtures,
    plan,
    plannedSemanticParityOnly: true,
    threeFixtureConcreteStimulusReady: stimulus.threeFixtureConcreteStimulusReady,
    twelveCallConcreteStimulusReady: stimulus.twelveCallConcreteStimulusReady,
    concreteStimulus: stimulus.concreteStimulus,
    liveProof,
    authoring: {
      level: DEFAULT_USER_AUTHORING_LEVEL,
      capabilities: capabilitiesFromUserAuthoringLevel(DEFAULT_USER_AUTHORING_LEVEL),
      evaluationNotes: authoringEvaluationNotes(DEFAULT_USER_AUTHORING_LEVEL),
      matrix: liveAuthoringCapabilityMatrix(),
    },
    length: {
      softAimChars: UNIFIED_TIER_AIM_CHARS,
      applicationMaxTokens: undefined,
      streamCharCap: resolveStreamCharCap(UNIFIED_TIER_AIM_CHARS),
      centerBandMaxIsMetadataNotCap: RP_QUALITY_CENTER_BAND_MAX_CHARS,
      uiEditMaxChars: ASSISTANT_MESSAGE_EDIT_MAX_CHARS,
      longOkClass: classifyVisibleLength(RP_QUALITY_CENTER_BAND_MAX_CHARS + 1),
    },
    cost,
    evaluationContract: contract,
    plannedPackets,
    pairedComparisons,
    adultPilot: "SEPARATE_FOLLOW_UP",
    notes: [
      "PRECALL only. Provider POST = 0.",
      "Cursor does not fill rubric scores or subjective hard gates.",
      RP_QUALITY_VERBOSITY_BIAS_INSTRUCTION,
      "NORMAL authoring allows [B] dialogue and major external action; do not deduct for that alone.",
      "Private [B] inner POV and irreversible fate remain hard gates.",
      "Fixture C is ordinary/manual. Auto-progress is not mixed into this 12-call pilot.",
      "19+ is a separate follow-up; listing nsfw does not force adult RP.",
      "plannedSemanticFingerprint is plan-template parity only, not production final-wire parity.",
      "Live identity proof does not include mutable current-room history.",
      "History opening is current greeting via buildGreetingBodyCueReviewCases; scene seeds stay in COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.",
      "A/B/C concrete readiness is derived from RP_QUALITY_PRECALL_FIXTURE_STIMULUS, not a separate manual bool.",
      "Live proof is injected evidence. The library does not own environment access results.",
      "Existing monthly memory-quality runner remains a different owner and still uses its historical qualification fixture.",
    ],
  };
}
