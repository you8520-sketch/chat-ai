/**
 * Deterministic PRECALL owner for the 4-model × 3-fixture Main RP prose
 * quality benchmark. Does not call providers, mutate DB, bill users, or
 * score prose. Production prompt wording is not this file's job.
 */
import { createHash } from "node:crypto";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
  type SelectedAI,
} from "@/lib/chatModels";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  ASSISTANT_MESSAGE_EDIT_MAX_CHARS,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import { resolveStreamCharCap } from "@/lib/responseLength";
import {
  RP_QUALITY_CENTER_BAND_MAX_CHARS,
  classifyVisibleLength,
} from "@/lib/rpQualityBaseline";
import {
  RP_QUALITY_VERBOSITY_BIAS_INSTRUCTION,
  authoringEvaluationNotes,
  buildQualityEvaluationContract,
  buildQualityOutputPacket,
  emptyRubricScores,
  liveAuthoringCapabilityMatrix,
  type RpQualityContentMode,
  type RpQualityOutputPacket,
  type RpQualityTurnKind,
} from "@/lib/rpQualityEvaluationPacket";
import {
  DEFAULT_USER_AUTHORING_LEVEL,
  capabilitiesFromUserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export const RP_QUALITY_PRECALL_VERSION = 1;
export const RP_QUALITY_PRECALL_PLANNED_CALLS = 12;
export const RP_QUALITY_PRECALL_RETRY = 0;
export const RP_QUALITY_PRECALL_FALLBACK = 0;
export const RP_QUALITY_PRECALL_AUXILIARY = 0;
export const RP_QUALITY_PRECALL_PAID_STATUS = "NOT_AUTHORIZED_PRECALL_ONLY" as const;

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

export const RP_QUALITY_PRECALL_RETIRED_GEMINI_LABELS = [
  "Gemini 3.1 Pro Preview",
  "Gemini 3.7 Flash",
] as const;

export const RP_QUALITY_PRECALL_INTENDED_SOURCE = Object.freeze({
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  lastRecordedDeployCommit: "2f5cb0b416ce214dfeb109f50622c0a45d61f62a",
  lastRecordedProofOwner:
    "scripts/lib/mainRpBodyCuePreflight.ts#LIVE_DEPLOYED_ROW_PROOF",
  reconfirmedAgainstCurrentProduction: false as const,
});

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
      "UNREADABLE from this VM; last recorded hashes live in LIVE_DEPLOYED_ROW_PROOF (deploy 2f5cb0b4)",
    scope: "current production rows, not historical qualification dumps",
    otherReaders: [
      "scripts/lib/mainRpBodyCuePreflight.LIVE_DEPLOYED_ROW_PROOF",
      "scripts/lib/rpModelQualificationFixture (historical 2026-08-25, not this source)",
    ],
    duplicateOrStaleOwner:
      "CANONICAL_RP_QUALIFICATION_SOURCE / character 10 dump must not be treated as current production",
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
    responsibility: "recent history/memory/canon inputs",
    canonicalOwner: "services/contextBuilder.ts input layers",
    effectiveValueSource:
      "UNREADABLE without a current production room read; not the 2026-08-25 qualification dump",
    scope: "history, long-term memory, episodic, compiled canon",
    otherReaders: ["buildContext"],
    duplicateOrStaleOwner: "rpModelQualificationFixture frozen memory cases",
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
    effectiveValueSource: "not assembled — live rows unread",
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
];

export type RpQualityPrecallModelPlan = {
  canonicalId: SelectedAI;
  displayLabel: string;
  provider: ReturnType<typeof selectedAIProvider>;
  wireModel: string;
};

export type RpQualityPrecallFixtureSpec = {
  id: RpQualityPrecallFixtureId;
  turnKind: RpQualityTurnKind;
  contentMode: RpQualityContentMode;
  authoringLevel: typeof DEFAULT_USER_AUTHORING_LEVEL;
  evaluationFocus: readonly string[];
  historySource: "current_production_room_if_readable";
  memoryCanonSource: "current_production_injection_if_readable";
  sceneControl: "production_default";
  targetLengthOwner: "UNIFIED_TIER_AIM_CHARS";
  notes: string;
};

export type RpQualityPrecallSemanticInput = {
  fixtureId: RpQualityPrecallFixtureId;
  characterId: number;
  characterName: string;
  personaName: string;
  authoringLevel: typeof DEFAULT_USER_AUTHORING_LEVEL;
  contentMode: RpQualityContentMode;
  historySource: RpQualityPrecallFixtureSpec["historySource"];
  userTurnIntent: RpQualityPrecallFixtureId;
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
  semanticFingerprint: string;
  adapterFingerprint: string;
  targetResponseChars: typeof UNIFIED_TIER_AIM_CHARS;
  applicationMaxTokens: undefined;
  streamCharCap: number;
  uiEditMaxChars: typeof ASSISTANT_MESSAGE_EDIT_MAX_CHARS;
  retry: 0;
  fallback: 0;
  auxiliary: 0;
};

export type RpQualityPrecallLiveProof = {
  status: "UNREADABLE";
  reconfirmed: false;
  intendedSource: typeof RP_QUALITY_PRECALL_INTENDED_SOURCE;
  localDbHasLikeOrRen: false;
  railwaySsh: "UNAUTHORIZED";
  syntheticSubstitution: false;
  historicalQualificationDumpUsedAsProduction: false;
  reason: string;
};

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
    | "MISSING_APPROVED_COST_BOUND"
    | "LIVE_DEPLOYED_ROW_UNREADABLE"
    | "NOT_AUTHORIZED_PRECALL_ONLY"
    | "PRECALL_OWNER_DOES_NOT_EXECUTE";
};

export type RpQualityPrecallReport = {
  version: typeof RP_QUALITY_PRECALL_VERSION;
  classification: RpQualityPrecallClassification;
  precallReady: false;
  paidExecutionStatus: typeof RP_QUALITY_PRECALL_PAID_STATUS;
  providerPosts: 0;
  plannedCalls: typeof RP_QUALITY_PRECALL_PLANNED_CALLS;
  executionPolicy: typeof RP_QUALITY_PRECALL_EXECUTION_POLICY;
  mutationPolicy: typeof RP_QUALITY_PRECALL_MUTATION_POLICY;
  ownerMap: readonly RpQualityPrecallOwnerRow[];
  models: readonly RpQualityPrecallModelPlan[];
  fixtures: readonly RpQualityPrecallFixtureSpec[];
  plan: readonly RpQualityPrecallSamplePlan[];
  liveProof: RpQualityPrecallLiveProof;
  authoring: {
    level: typeof DEFAULT_USER_AUTHORING_LEVEL;
    capabilities: ReturnType<typeof capabilitiesFromUserAuthoringLevel>;
    evaluationNotes: readonly string[];
    matrix: ReturnType<typeof liveAuthoringCapabilityMatrix>;
  };
  length: {
    softAimChars: typeof UNIFIED_TIER_AIM_CHARS;
    applicationMaxTokens: undefined;
    streamCharCap: number;
    centerBandMaxIsMetadataNotCap: typeof RP_QUALITY_CENTER_BAND_MAX_CHARS;
    uiEditMaxChars: typeof ASSISTANT_MESSAGE_EDIT_MAX_CHARS;
    longOkClass: ReturnType<typeof classifyVisibleLength>;
  };
  cost: RpQualityPrecallCostBound;
  evaluationContract: ReturnType<typeof buildQualityEvaluationContract>;
  plannedPackets: readonly RpQualityOutputPacket[];
  pairedComparisons: readonly RpQualityPrecallPairSlot[];
  adultPilot: "SEPARATE_FOLLOW_UP";
  notes: readonly string[];
};

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
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
  if (models.length !== 4) {
    throw new Error(`Expected 4 active Main RP models, got ${models.length}`);
  }
  const ids = models.map((row) => row.canonicalId);
  if (JSON.stringify(ids) !== JSON.stringify([...MAIN_RP_MODEL_IDS])) {
    throw new Error("PRECALL model set is not MAIN_RP_MODEL_IDS");
  }
  const labels = models.map((row) => row.displayLabel).sort();
  const expected = [
    "Claude Opus 5.5",
    "DeepSeek V4.1 Flash",
    "GPT-6.1 Sol",
    "Gemini 3.8 Flash",
  ];
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Main RP labels: ${labels.join(", ")}`);
  }
  for (const retired of RP_QUALITY_PRECALL_RETIRED_GEMINI_LABELS) {
    if (labels.includes(retired)) {
      throw new Error(`Retired Gemini present in PRECALL set: ${retired}`);
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
      historySource: "current_production_room_if_readable",
      memoryCanonSource: "current_production_injection_if_readable",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Ordinary turn. Same deployed 라이크/렌 source once readable. No new story-prompt system.",
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
      historySource: "current_production_room_if_readable",
      memoryCanonSource: "current_production_injection_if_readable",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Ordinary turn. Conflict/action/spatial scene on the same character/persona once readable.",
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
      historySource: "current_production_room_if_readable",
      memoryCanonSource: "current_production_injection_if_readable",
      sceneControl: "production_default",
      targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
      notes:
        "Ordinary path, not auto-progress. Auto would be turnKind=auto and scored separately.",
    },
  ];
}

export function fixtureSemanticInput(
  fixture: RpQualityPrecallFixtureSpec
): RpQualityPrecallSemanticInput {
  return {
    fixtureId: fixture.id,
    characterId: RP_QUALITY_PRECALL_INTENDED_SOURCE.characterId,
    characterName: RP_QUALITY_PRECALL_INTENDED_SOURCE.characterName,
    personaName: RP_QUALITY_PRECALL_INTENDED_SOURCE.personaName,
    authoringLevel: fixture.authoringLevel,
    contentMode: fixture.contentMode,
    historySource: fixture.historySource,
    userTurnIntent: fixture.id,
    memoryCanonSource: fixture.memoryCanonSource,
    sceneControl: fixture.sceneControl,
    targetLengthOwner: fixture.targetLengthOwner,
    turnKind: fixture.turnKind,
    liveRowReconfirmed: false,
  };
}

export function semanticInputFingerprint(input: RpQualityPrecallSemanticInput): string {
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
      const semantic = fixtureSemanticInput(fixture);
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
        semanticFingerprint: semanticInputFingerprint(semantic),
        adapterFingerprint: adapterDiffFingerprint(adapter),
        targetResponseChars: UNIFIED_TIER_AIM_CHARS,
        applicationMaxTokens,
        streamCharCap: resolveStreamCharCap(UNIFIED_TIER_AIM_CHARS),
        uiEditMaxChars: ASSISTANT_MESSAGE_EDIT_MAX_CHARS,
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

export function assertFixtureSemanticParity(
  plan: readonly RpQualityPrecallSamplePlan[] = buildRpQualityPrecallPlan()
): void {
  for (const fixtureId of RP_QUALITY_PRECALL_FIXTURE_IDS) {
    const rows = plan.filter((row) => row.fixtureId === fixtureId);
    if (rows.length !== 4) {
      throw new Error(`${fixtureId} must have exactly 4 model rows`);
    }
    const semantic = new Set(rows.map((row) => row.semanticFingerprint));
    if (semantic.size !== 1) {
      throw new Error(`${fixtureId} semantic inputs are not identical across models`);
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

export function evaluateLiveDeployedInputProof(): RpQualityPrecallLiveProof {
  return {
    status: "UNREADABLE",
    reconfirmed: false,
    intendedSource: RP_QUALITY_PRECALL_INTENDED_SOURCE,
    localDbHasLikeOrRen: false,
    railwaySsh: "UNAUTHORIZED",
    syntheticSubstitution: false,
    historicalQualificationDumpUsedAsProduction: false,
    reason:
      "This VM cannot read Railway /data/app.db read-only (railway ssh Unauthorized; local data/app.db has no 라이크 id=18 or 렌). LIVE_DEPLOYED_ROW_PROOF is a recorded deploy-2f5cb0b4 hash, not a reconfirmed current-main row. Synthetic/historical dumps were not substituted.",
  };
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
      "Production assembled input size is unavailable without a live row read. Catalog rates are recorded as assumptions only. No USD/KRW bound is invented or approved.",
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

export function artifactContainsSecret(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return SECRET_LEAK_RE.test(value);
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

export function startRpQualityPrecallPaidExecution(input?: {
  liveProof?: RpQualityPrecallLiveProof;
  approvedCostBoundUsd?: number | null;
  approvedCostBoundKrw?: number | null;
  paidExecutionAuthorized?: boolean;
}): RpQualityPrecallStartDenial {
  const liveProof = input?.liveProof ?? evaluateLiveDeployedInputProof();
  const hasApprovedBound =
    input?.approvedCostBoundUsd != null || input?.approvedCostBoundKrw != null;
  if (!hasApprovedBound) {
    return {
      started: false,
      paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
      providerPosts: 0,
      reason: "MISSING_APPROVED_COST_BOUND",
    };
  }
  if (liveProof.status === "UNREADABLE" || liveProof.reconfirmed === false) {
    return {
      started: false,
      paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
      providerPosts: 0,
      reason: "LIVE_DEPLOYED_ROW_UNREADABLE",
    };
  }
  if (input?.paidExecutionAuthorized !== true) {
    return {
      started: false,
      paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
      providerPosts: 0,
      reason: "NOT_AUTHORIZED_PRECALL_ONLY",
    };
  }
  return {
    started: false,
    paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
    providerPosts: 0,
    reason: "PRECALL_OWNER_DOES_NOT_EXECUTE",
  };
}

export function buildRpQualityPrecallReport(): RpQualityPrecallReport {
  const models = rpQualityPrecallBenchmarkModels();
  assertActiveMainRpBenchmarkSet(models);
  const fixtures = rpQualityPrecallFixtures();
  const plan = buildRpQualityPrecallPlan();
  assertFixtureSemanticParity(plan);
  const liveProof = evaluateLiveDeployedInputProof();
  const cost = evaluateRpQualityPrecallCostBound();
  const plannedPackets = buildPlannedQualityPackets(plan);
  const pairedComparisons = buildPairedComparisonPackets(plan);
  const contract = buildQualityEvaluationContract();
  return {
    version: RP_QUALITY_PRECALL_VERSION,
    classification: "NOT_REPRODUCIBLE",
    precallReady: false,
    paidExecutionStatus: RP_QUALITY_PRECALL_PAID_STATUS,
    providerPosts: 0,
    plannedCalls: RP_QUALITY_PRECALL_PLANNED_CALLS,
    executionPolicy: RP_QUALITY_PRECALL_EXECUTION_POLICY,
    mutationPolicy: RP_QUALITY_PRECALL_MUTATION_POLICY,
    ownerMap: RP_QUALITY_PRECALL_OWNER_MAP,
    models,
    fixtures,
    plan,
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
      "Existing monthly memory-quality runner remains a different owner and still uses its historical qualification fixture.",
    ],
  };
}
