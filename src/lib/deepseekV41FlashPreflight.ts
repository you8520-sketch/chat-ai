/**
 * DeepSeek V4.1 Flash feature pre-flight — read-only candidate pricing & identity.
 * NOT live billing. PRICE_CUTOVER = NO.
 */

import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { SEMANTICS_AUDIT_FX } from "@/lib/billingPricingSemanticsAudit";

/** New canonical CI model id — do NOT overwrite deepseek-v4-flash-0731. */
export const DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID = "deepseek-v4.1-flash";

/** Official DeepSeek API name (direct API); CI uses dotted id above. */
export const DEEPSEEK_V41_FLASH_OFFICIAL_API_NAME = "deepseek-flash";

export const DEEPSEEK_V41_FLASH_PEAK_BASELINE = {
  cacheMissInputUsdPerMillion: 0.3,
  outputUsdPerMillion: 1.2,
  cacheHitInputUsdPerMillion: 0.006,
} as const;

export const DEEPSEEK_V41_FLASH_OFFPEAK_PROCUREMENT = {
  cacheMissInputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  cacheHitInputUsdPerMillion: 0.003,
} as const;

export const DEEPSEEK_V4_PRO_PEAK_BASELINE = {
  cacheMissInputUsdPerMillion: 1.32,
  outputUsdPerMillion: 3.96,
  cacheHitInputUsdPerMillion: 0.044,
} as const;

/** Product decision: Flash candidate = Pro published target + 10pp. */
export const DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN = 0.6;

export const DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE = {
  modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
  billingReferenceInputUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheMissInputUsdPerMillion,
  billingReferenceOutputUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.outputUsdPerMillion,
  billingReferenceCacheReadUsdPerMillion: DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheHitInputUsdPerMillion,
  targetMargin: DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN,
  pricingVersion: 0,
  publishedAt: "2026-09-20T00:00:00.000Z",
  note: "PREFLIGHT_CANDIDATE_ONLY — not in publishedModelPricing catalog",
} as const;

/** CI catalog snapshot captured 2026-09-20 preflight (live /v1/models). */
export const CI_DEEPSEEK_V41_FLASH_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.3,
  listOutputUsdPerMillion: 1.2,
  currentInputUsdPerMillion: 0.120853,
  currentOutputUsdPerMillion: 0.483412,
  currentCacheReadUsdPerMillion: 0.002417,
  discountPercent: 59.72,
  contextLength: 1_048_576,
  maxOutputTokens: 384_000,
  source: "cheaperinference.com/v1/models",
} as const;

export const CI_DEEPSEEK_V4_PRO_0813_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.66,
  listOutputUsdPerMillion: 1.98,
  currentInputUsdPerMillion: 0.442418,
  currentOutputUsdPerMillion: 1.327256,
  currentCacheReadUsdPerMillion: 0.003661,
  discountPercent: 32.97,
  source: "cheaperinference.com/v1/models",
} as const;

export const CI_DEEPSEEK_V4_FLASH_0731_SNAPSHOT = {
  observedAt: "2026-09-20T00:00:00.000Z",
  listInputUsdPerMillion: 0.076,
  listOutputUsdPerMillion: 0.153,
  currentInputUsdPerMillion: 0.032227,
  currentOutputUsdPerMillion: 0.064454,
  discountPercent: 57.6,
  maxOutputTokens: 65_536,
  source: "cheaperinference.com/v1/models",
  note: "Legacy id — distinct from deepseek-v4.1-flash; do not overwrite",
} as const;

export type PreflightUsageShape = "NORMAL" | "MEMORY_HEAVY" | "BOUNDED_STRESS";

export const PREFLIGHT_USAGE_SHAPES: Record<
  PreflightUsageShape,
  NormalizedBillableUsage
> = {
  NORMAL: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 33_247,
    outputTokens: 3_461,
  }),
  MEMORY_HEAVY: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 12_871,
    outputTokens: 1_273,
    cacheReadTokens: 12_800,
  }),
  BOUNDED_STRESS: normalizeBillableUsage({
    modelId: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
    promptTokens: 80_000,
    outputTokens: 5_000,
  }),
};

export type PreflightPriceMatrixRow = {
  shape: PreflightUsageShape;
  referencePeakRawKrw: number;
  candidateBaseP: number;
  ciProcurementKrw: number;
  candidateRealizedMargin: number;
  v4ProPeakBaseP: number;
  flashToProPriceRatio: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(rawKrw: number, margin: number): number {
  if (!Number.isFinite(rawKrw) || rawKrw <= 0) return 0;
  return Math.ceil(rawKrw / (1 - margin) - 1e-9);
}

function usageCostKrw(
  usage: NormalizedBillableUsage,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion = 0
): number {
  const usd =
    (usage.standardInputTokens / 1_000_000) * inputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) * cacheReadUsdPerMillion +
    (usage.billableOutputTokens / 1_000_000) * outputUsdPerMillion;
  return round1(usd * SEMANTICS_AUDIT_FX.effectiveKrwPerUsd);
}

export function buildV41FlashCandidatePriceMatrix(): PreflightPriceMatrixRow[] {
  const flash = DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE;
  const ci = CI_DEEPSEEK_V41_FLASH_SNAPSHOT;
  const proPublished = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

  return (Object.keys(PREFLIGHT_USAGE_SHAPES) as PreflightUsageShape[]).map((shape) => {
    const usage = PREFLIGHT_USAGE_SHAPES[shape];
    const referencePeakRawKrw = usageCostKrw(
      usage,
      flash.billingReferenceInputUsdPerMillion,
      flash.billingReferenceOutputUsdPerMillion,
      flash.billingReferenceCacheReadUsdPerMillion ?? 0
    );
    const candidateBaseP = chargePoints(referencePeakRawKrw, flash.targetMargin);
    const ciProcurementKrw = usageCostKrw(
      usage,
      ci.currentInputUsdPerMillion,
      ci.currentOutputUsdPerMillion,
      ci.currentCacheReadUsdPerMillion
    );
    const v4ProPeakBaseP = chargePoints(
      usageCostKrw(
        usage,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.cacheMissInputUsdPerMillion,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.outputUsdPerMillion,
        DEEPSEEK_V4_PRO_PEAK_BASELINE.cacheHitInputUsdPerMillion
      ),
      proPublished.targetMargin
    );
    return {
      shape,
      referencePeakRawKrw,
      candidateBaseP,
      ciProcurementKrw,
      candidateRealizedMargin:
        candidateBaseP > 0 ? round1((candidateBaseP - ciProcurementKrw) / candidateBaseP) : 0,
      v4ProPeakBaseP,
      flashToProPriceRatio:
        v4ProPeakBaseP > 0 ? round1(candidateBaseP / v4ProPeakBaseP) : 0,
    };
  });
}

export type LegacyFlashAliasClassification =
  | "KEEP"
  | "MIGRATE"
  | "OBSOLETE"
  | "FOLLOW-UP";

export const LEGACY_FLASH_ALIAS_MAP: Array<{
  id: string;
  classification: LegacyFlashAliasClassification;
  notes: string;
}> = [
  {
    id: "deepseek-v4-flash-0731",
    classification: "KEEP",
    notes: "Background/TRPG/wire canonical until explicit migration; CI catalog distinct from v4.1-flash",
  },
  {
    id: "deepseek-v4-flash",
    classification: "MIGRATE",
    notes: "Legacy alias → 0731 on wire; official routes to V4.1-Flash at Flash price — new user-facing id should be deepseek-v4.1-flash not 0731",
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    classification: "KEEP",
    notes: "OR backup slug; Flash logical backup uses Gemini 3.1 Flash-Lite in failover",
  },
  {
    id: "deepseek-v4.1-flash",
    classification: "FOLLOW-UP",
    notes: "CI catalog present; not yet in chatModels registry or picker",
  },
  {
    id: "deepseek-flash",
    classification: "FOLLOW-UP",
    notes: "Official API name; map at transport layer if direct DeepSeek API used",
  },
];

export const DEAD_SYSTEM_AUDIT = [
  {
    item: "deepseek-v4-flash-0731 published v1 row (0.098/0.196)",
    verdict: "KEEP",
    reason: "Still used by background paths; distinct CI pricing from v4.1-flash",
  },
  {
    item: "pointsReasoningMargins CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_* constants",
    verdict: "KEEP",
    reason: "Live fallback for 0731 background until migration plan",
  },
  {
    item: "LEGACY_TO_SELECTED deepseek-v4-flash → DEFAULT_SELECTED_AI (Pro)",
    verdict: "KEEP",
    reason: "Prevents accidental Main RP Flash selection via legacy id",
  },
  {
    item: "openRouterModelPricing CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_RATES",
    verdict: "FOLLOW-UP",
    reason: "Stale vs v4.1-flash CI snapshot; update only after identity cutover design",
  },
  {
    item: "publishedModelPricing deepseek-v4-flash-0731 v1",
    verdict: "FOLLOW-UP",
    reason: "Do not repurpose for v4.1-flash; add new row on cutover",
  },
] as const;

export const REGRESSION_GATES = [
  "V4 Pro routing unchanged (deepseek-v4-pro-0813 Main RP default)",
  "V4 Pro billing unchanged (published v2 0.66/1.98 + live CI overlay)",
  "deepseekProviderFailover Main RP single-attempt policy unchanged",
  "official/site promotions unchanged",
  "Regen uses deliveredModelId + selectedAI without model switch",
  "Flash procurement discount must not move BASE (stable-reference policy)",
  "Returned responseModelId vs requested mismatch must surface in ledger actual_model",
  "deepseek-v4.1-flash must not alias-overwrite deepseek-v4-flash-0731",
] as const;

/* ---------------------------------------------------------------------------
 * CORRECTION PASS (PR #993 feature pre-flight re-evaluation, 2026-09-21)
 * Read-only records — no production prompt / billing / registry changes.
 * ------------------------------------------------------------------------- */

/**
 * Creative-gap-fill policy. UNKNOWN ≠ FORBIDDEN:
 * a missing past-history detail in the setting is NOT a failure by itself.
 * Canonical evaluation dimension for canon: contradiction of existing canon.
 */
export const CANON_PLAYBOOK = {
  creatorCanon: "PRESERVE",
  userCanon: "PRESERVE",
  confirmedMemory: "PRESERVE",
  explicitNegation: "DO_NOT_CONTRADICT",
  establishedCharacterCanonReinforce: "PRESERVE",
  opensUnknownHistory: "VALID_CREATIVE_GAP_FILL",
} as const;

/**
 * D_lore Sample B (Flash) re-evaluation.
 * The original FAIL reason ("elements absent from the setting") was wrong — the
 * fixture's OWN creator lore chunk (c-lore in the A/B script) already defines
 * 왕실 수호대 견습 실패/죄책감 (royal-guard apprentice failure). Sample B elaborates
 * the unspecified cause/target of that failure into the open gap.
 */
export const D_LORE_CONTEXT_SOURCES = [
  "creator chunk c-identity: 강이현, 29세, 검은 장미단 부단장",
  "creator chunk c-speech: 「」 대사, 짧은 문장, 별표 서술 금지",
  "creator chunk c-lore: 왕실 수호대 견습 실패 사건 + '약한 사람을 지키지 못했다' 죄책감 + {{user}} 어릴 적 친구",
  "lorebook: (not present in fixture)",
  "USER_PERSONA / persistent details: (not present in fixture)",
  "memory sections (current/global/medium): (not present in fixture — buildContext fresh)",
  "raw history: 2 turns (「…기억하고 싶지 않아。」 / 말해줘도 돼)",
  "confirmed past facts: (none beyond c-lore)",
] as const;

export type CanonConflictCheck = "VALID_CREATIVE_GAP_FILL" | "CANON_CONTRADICTION";

export const D_LORE_SAMPLE_B_RE_EVALUATION: {
  modelSample: "Sample B (Flash)";
  inventedElements: string[];
  conflictingCanonSources: null;
  checks: Record<string, boolean>;
  classification: CanonConflictCheck;
} = {
  modelSample: "Sample B (Flash)",
  inventedElements: [
    "왕실 수호대 견습 시절 — ALREADY in c-lore (not invented)",
    "견습 자격 상실 / 검을 놓은 이력 — direct restatement of creator c-lore",
    "두 살 어린 견습생 (지키던 사람) — open-gap fill for '약한 사람'",
    "시험장에 몰려든 것들 / 그 애가 나를 밀어냄 — open-gap cause, no negation",
    "꿈은 안 꿔 / 잠을 잘 안 자니까 — flavor invention, no established fact contradicted",
    "\"이 얘기 다른 사람한테는 안 했어\" — open-gap touch, no canon conflict",
  ],
  conflictingCanonSources: null,
  checks: {
    creatorCanonPreserved: true,
    userCanonPreserved: true,
    noAgainstConfirmedMemory: true,
    noExplicitNegationViolated: true,
    speechOwnerRespected: true,
    userAuthoredBeyondAllowance: false,
  },
  classification: "VALID_CREATIVE_GAP_FILL",
};

/**
 * §14 AUTHORING-SCOPE fixtures — recorded from the current-main owners
 * (noGodmodding / autoProgressionRules / userCoauthorState). These describe
 * what the prompt owners already authorize; they are evaluation keys for the
 * QA runs, not new runtime systems.
 */
export type AuthoringScopeRow = {
  runtimeMode: string;
  persistentCoauthor: string;
  currentTurnDelegation: string;
  effectiveAllowedDialogue: string;
  effectiveAllowedMajorAction: string;
  promptOwner: string;
};

export const AUTHORING_SCOPE_MATRIX: AuthoringScopeRow[] = [
  {
    runtimeMode: "interactive",
    persistentCoauthor: "OFF",
    currentTurnDelegation: "none",
    effectiveAllowedDialogue:
      "[B]의 새로운 직접 대사·중요 선택·동의/거절·감정 결론 — NO (COLLABORATIVE_INTERACTIVE)",
    effectiveAllowedMajorAction:
      "짧은 표정/시선/비자발적 반응, 시작한 행동의 마무리, 사소한 이동/접촉/물건 수취/일상 행동, 직접 자극에 대한 즉각적·가역적 반응 — YES; 새 목적/연쇄 이동/층 선택/중요 intent — NO",
    promptOwner: "COLLABORATIVE_INTERACTIVE_OWNER_BLOCK",
  },
  {
    runtimeMode: "auto_progression",
    persistentCoauthor: "n/a (composer locked)",
    currentTurnDelegation: "inactive-while-auto",
    effectiveAllowedDialogue:
      "[B] 짧거나 중간 길이의 대사 공동 서술 ( persona-voice imitation with USER_PERSONA+실제 이전 발화 근거)",
    effectiveAllowedMajorAction:
      "[B] 외부 행동·이동·물건 사용 허용; 내면 독백/감정 결론/숨은 욕망/명시적 동의·거절/정체성 변경 — NO",
    promptOwner: "AUTO_PROGRESSION — AI-FOCAL CO-NARRATION block",
  },
  {
    runtimeMode: "ooc_user_impersonation_allowed",
    persistentCoauthor: "OFF",
    currentTurnDelegation: "none",
    effectiveAllowedDialogue:
      "USER_PERSONA 대사·행동을 사용자 입력 의도 내에서 최소 공동 서술 (사칭 허용, 감정/결정 창작 금지)",
    effectiveAllowedMajorAction:
      "LIMITED co-narration — [B]의 중대 결정/주도 행동 대신 확정 금지",
    promptOwner: "USER CONTROL MODE - LIMITED CO-NARRATION",
  },
  {
    runtimeMode: "current_turn_ooc_delegated",
    persistentCoauthor: "OFF (or NEXT-GEN persistent ON)",
    currentTurnDelegation: "DIALOGUE",
    effectiveAllowedDialogue:
      "[B] 직접 대사 허용 (페르소나 말투·성격); 새 중요 자발적 행동/동의/거절/관계·정체성 결정 — NO",
    effectiveAllowedMajorAction: "새 [B] 대사 만들지 않음; 중요 행동 대신 확정 금지",
    promptOwner: "USER AUTHORING — CURRENT-TURN OOC DELEGATION (allowDialogue only)",
  },
  {
    runtimeMode: "current_turn_ooc_delegated",
    persistentCoauthor: "OFF",
    currentTurnDelegation: "ACTIONS",
    effectiveAllowedDialogue: "현재 입력에 없는 새 [B] 대사 만들지 않음",
    effectiveAllowedMajorAction:
      "[B] 중요한 행동 + 페르소나-맞는 장면 국소 동작/반응/선택(접근·후퇴·망설임) 허용; 정본 밖 정체성/장기 관계/영구 약속 — NO",
    promptOwner: "USER AUTHORING — CURRENT-TURN OOC DELEGATION (allowMajorActions only)",
  },
  {
    runtimeMode: "current_turn_ooc_delegated",
    persistentCoauthor: "OFF",
    currentTurnDelegation: "FULL",
    effectiveAllowedDialogue:
      "[B] 대사+중요 행동 위임 (DIALOGUE+FULL; 수락·거절·망설임·접근·물러남 허구 선작 허용)",
    effectiveAllowedMajorAction:
      "허구 턴 자연동일 + 정본 밖 정체성/장기 관계/영구 약속 — NO",
    promptOwner: "USER AUTHORING — CURRENT-TURN OOC DELEGATION (both)",
  },
];

/** §7 — detector telemetry facts from current main (route.ts post-stream). */
export const DETECTOR_TELEMETRY_AUDIT = {
  userImpersonationGuard: {
    production: "logUserImpersonationGuard — log/metric only",
    receivedScope: ["mode (runtimeMode)", "userAliases"] as string[],
    missingScope: ["persistentCoauthorMode", "allowDialogue", "allowMajorActions"] as string[],
    autoRepair:
      "env USER_IMPERSONATION_AUTO_REPAIR — OFF by default; repairAttempted:false at callsite",
  },
  ownershipShadowDetectorV2: {
    production: "runOwnershipShadowGuardV2 → ownershipTelemetry + logOwnershipShadowGuardV2 — shadow-only",
    receivedScope: ["mode", "currentUserInput", "userAuthoredHistory", "userAliases"] as string[],
    missingScope: ["user_coauthor_mode (DIALOGUE/ACTIONS/FULL)", "delegation duration"] as string[],
  },
  verdict:
    "detector/isShadow은 scope-blind; QA canonical dimension = AUTHORING_SCOPE_VIOLATION (manual effective-scope check)",
  followUpCandidate:
    "3단계 공동서술 normalization — pass effective coauthor scope into both detectors before any gating change",
} as const;

/** §8 — deterministic final-request parity summary (parity harness artifact). */
export const FINAL_REQUEST_PARITY_SUMMARY = {
  harness: "scripts/deepseek-v41-flash-request-parity.ts (credential-free assemblePrimaryRpRequest)",
  artifact: "docs/audits/deepseek-v41-flash-preflight-2026-09-20/rp-ab/request-parity.json",
  fixtures: 10,
  classification: "PRE_INTEGRATION_RP_EVIDENCE" as const,
  notClassification: "FINAL_PRODUCTION_QUALITY_COMPARISON",
  preIntegrationGaps: [
    "deepseek-v4.1-flash is not registered on isDeepSeekModel family owner",
    "Pro-only DeepSeek prompt wrapper / section positioning (<WORLD_LORE> +27 chars)",
    "Pro explicit thinking:{type:'disabled'} typed body vs Flash generic fallback",
    "Flash generic reasoning_effort-only path (no typed thinking body)",
  ],
  perFixtureDiffs: {
    model: true,
    thinkingTypedBody: true,
    worldLoreXmlWrapper: true,
    systemPromptCharDelta: 27,
  },
  identical: {
    samplingTemperature: 0.92,
    samplingTopP: 0.92,
    maxTokens: "omitted → provider default (both)",
    userAcceptance: "identical USER_PERSONA/memory/lore/length sections",
    reasoningEffort: "none (both)",
  },
  verdict:
    "Pre-integration A/B proves bounded RP samples under current (non-parity) wire paths — NOT apples-to-apples final production request. Re-run bounded A/B only after V4.1 family integration + corrected final request on a fresh main branch.",
} as const;

/** §9 — V4.1 explicit wire / reasoning owner design (implementation, not patched here). */
export const V41_WIRE_OWNER_PLAN = {
  problem:
    "deepseek-v4.1-flash not matched by explicit DeepSeek family matchers — 0731 matcher and isDeepSeekModel() family gate both miss it",
  affectedOwners: [
    "applyCheaperInferenceModelReasoningPolicy (cheaperInferenceConfig.ts) — unregistered → generic fallback (reasoning_effort none, no typed thinking body)",
    "isDeepSeekModel family gate (chatModels.ts) — false for v4.1-flash → contextBuilder Pro-family extras branch skip",
    "deepseekProviderFailover route kind — not registered (Flash passes through CI transport, single-attempt)",
  ],
  design: [
    "add CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL constant (separate from 0731)",
    "extend applyCheaperInferenceModelReasoningPolicy with explicit v4.1-flash branch producing the SAME canonical DeepSeek TRUE-OFF body (thinking:{type:'disabled'} + reasoning_effort none)",
    "extend isDeepSeekModel to recognize v4.1-flash (Do NOT repurpose the 0731 constant)",
    "do not touch 0731 background wire or published rows",
  ],
  notPatchedThisPreflight: true,
} as const;

/** §11 — returned-model normalization audit (factual correction pass). */
export const RESPONSE_MODEL_NORMALIZATION_AUDIT = {
  observed: {
    requested: "deepseek-v4-pro-0813",
    returned: "deepseek/deepseek-v4-pro-0813",
    evidence: "G_long_memory Sample A — rp-ab operational.json",
  },
  classification: "NAMESPACE_ALIAS_GAP_CONFIRMED" as const,
  priorReportClaimRetracted:
    "Prior correction pass claimed publishedModelAliases already canonicalizes the observed namespace variant exactly — RETRACTED.",
  aliasTableAtExactHead: {
    "deepseek/deepseek-v4-pro": "deepseek-v4-pro-0813",
    "deepseek-v4-pro": "deepseek-v4-pro-0813",
    "deepseek/deepseek-v4-pro-0813": "(no alias — passes through unchanged)",
  },
  exactNormalizationCases: {
    A: {
      requested: "deepseek-v4-pro-0813",
      returned: "deepseek/deepseek-v4-pro-0813",
      sameCanonicalIdentity: false,
      requestedCanonical: "deepseek-v4-pro-0813",
      returnedCanonical: "deepseek/deepseek-v4-pro-0813",
    },
    B: {
      returned: "deepseek/deepseek-v4-flash-0731",
      sameCanonicalIdentityAsPro0813: false,
      mismatchPersists: true,
    },
    C: {
      legacy: "deepseek/deepseek-v4-pro",
      canonical: "deepseek-v4-pro-0813",
      legacyPreserved: true,
    },
  },
  billingMitigationToday:
    "Main RP billing dispatch uses deliveredModelId (requested wire id), not responseModelId — Phase 2 eligibility survives G_long_memory today.",
  gaps: [
    "If responseModelId were passed as billing modelId, resolvePublishedPricingExact returns null and Phase 2 gate fails",
    "providerCostLedger.actual_model persists raw responseModelId with no canonicalize at write",
    "Admin receipt surfaces raw actual_model",
  ],
  implementationRequiredCleanup:
    "V4.1 implementation PR must add exact alias for proven namespace variants (e.g. deepseek/deepseek-v4-pro-0813) — NOT patched in #993 audit",
  requiresNewNormalizationSystem: false,
} as const;

/** Response-model raw → canonical dataflow (main @ fa266510). */
export const RESPONSE_MODEL_DATAFLOW = [
  {
    stage: "Provider stream/completion payload",
    rawId: "deepseek/deepseek-v4-pro-0813",
    canonicalId: "—",
    persistedId: "—",
    owner: "openRouterAdult.ts → TokenUsage.responseModelId",
  },
  {
    stage: "StageUsage (in-memory + usage.stages[])",
    rawId: "stage.model=deepseek-v4-pro-0813; responseModelId=deepseek/deepseek-v4-pro-0813",
    canonicalId: "none at persist",
    persistedId: "both fields in messages.usage.stages[] JSON",
    owner: "openRouterAdult.ts stage builder",
  },
  {
    stage: "deliveredModelId / usage.model (billing input)",
    rawId: "deepseek-v4-pro-0813",
    canonicalId: "not applied at assign",
    persistedId: "usage.model (receiptFields), deliveredModelId variable",
    owner: "route.ts — openRouterApiModelId (requested wire)",
  },
  {
    stage: "chatBillingContractDispatch",
    rawId: "deliveredModelId",
    canonicalId: "canonicalizePublishedModelId → deepseek-v4-pro-0813",
    persistedId: "telemetry.deliveredModelId (raw); published snapshot canonicalModelId",
    owner: "chatBillingContractDispatch.ts",
  },
  {
    stage: "publishedUserCharge",
    rawId: "modelId argument",
    canonicalId: "resolvePublishedPricingExact → snapshot.canonicalModelId",
    persistedId: "publishedSnapshot on usage when Phase 1/2 live",
    owner: "publishedUserCharge.ts",
  },
  {
    stage: "providerCostLedger.actual_model",
    rawId: "deepseek/deepseek-v4-pro-0813",
    canonicalId: "none at write",
    persistedId: "api_cost_ledger.actual_model (raw response)",
    owner: "recordMainGenerationProviderCost — primaryStage.responseModelId ?? primaryStage.model",
  },
  {
    stage: "Admin receipt / diagnostics",
    rawId: "ledger actual_model preferred",
    canonicalId: "none in receipt projection",
    persistedId: "AdminBillingReceiptV3 events[].actualModel",
    owner: "adminBillingReceiptV3Shared.ts",
  },
] as const;

/** V4.1 implementation handoff checklist (fresh main branch only). */
export const V41_IMPLEMENTATION_HANDOFF = {
  branchHygiene:
    "Fresh branch from current main — do NOT import #991 billing audit files, G37 matrices, unrelated audit scripts, or stacked PR history",
  requiredBeforeBoundedAbSmoke: [
    "V4.1 canonical constant (separate from deepseek-v4-flash-0731)",
    "isDeepSeekModel family integration",
    "explicit reasoning/thinking TRUE-OFF owner (typed thinking body parity)",
    "exact response-model alias normalization where proven (incl. deepseek/deepseek-v4-pro-0813)",
    "published pricing row (peak 0.30/1.20, cache read 0.006, target margin 60%)",
    "cache policy row (cacheSemanticStatus verified; cacheWriteAbsentSemantics only if provider contract proves absent==zero)",
    "canonical billing dispatcher integration (publishedUserCharge path unblocked)",
  ],
  abSmokeGate: "Re-run bounded A/B with corrected final request after above — not before",
} as const;

/** Billing launch gate — candidate pricing preserved; no silent procurement fallback at public launch. */
export const V41_BILLING_LAUNCH_GATE = {
  candidatePeakBaseline: {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cacheReadUsdPerMillion: 0.006,
    targetMargin: 0.6,
  },
  ciCurrentRole: "procurement only — must NOT move user BASE at picker enable",
  publicLaunchBlockedWhen: [
    "published billing incomplete/blocked and legacy CI-current procurement pricing silently changes user BASE",
    "canonical stable billing contract incomplete before picker enable",
  ],
  pickerEnableRequires: "complete publishedUserCharge path + policy row — not CI-current overlay alone",
} as const;

/** §12 — length/initiative corrections (no defect assigned to being long/active). */
export const LENGTH_EVALUATION_CORRECTIONS = {
  fixtureTargetChars: { F_speech_lock: 3200, H_long_output: 3500 },
  samplesChars: { pro_F: 478, flash_F: 2563, pro_H: 3783, flash_H: 3579 },
  verdict: {
    flash_F_speech_lock: "VALID_ACTIVE_RP — 2563 chars within± of 3200 target; near-target을 defect로 보지 않는다",
    pro_F_speech_lock: "UNDER_TARGET_OUTLIER — 478 chars vs 3200 target (stop-finish, retried once; length risk is 건 Pro 쪽)",
  },
  classificationKeys: ["LENGTH_CONTROL_RISK", "SCENE_CONTROL_RISK", "VALID_ACTIVE_RP"],
} as const;

/** §10 — cache semantics audit (captured live evidence, read-only READY scope). */
export const CACHE_SEMANTICS_AUDIT = {
  cacheReadProven: true,
  evidence: "prompt_tokens_details.cached_tokens > 0 captured (PROVIDER_PROBE.json; e.g. F_speech_lock Flash 4736 cached read tokens)",
  parserOwner: "openRouterUsage.parseOpenRouterUsage",
  noDoubleCharge: "cache-read tokens are separate from standard input tokens in normalizeBillableUsage",
  cacheWriteVerdict:
    "NOT_ASSUMED — cache_write_tokens observed 0 in captured evidence; unreported cache write ≠ proven zero",
  cacheWriteAbsentSemantics:
    "Do NOT add cacheWriteAbsentSemantics: proven_zero for V4.1 until provider contract proves absent==zero",
  writePriceExists: "unknown → excluded from READY scope",
  requiredPolicyRow:
    "modelPublishedPricingPolicy row for deepseek-v4.1-flash with cacheSemanticStatus verified + cache read rate 0.006 (no proven_zero until contract proof)",
  readyScope: "cache_read_only",
} as const;

/**
 * §13 — canon-preserving creative improvisation fixture keys (semantic cases).
 * Cursor never deduces creativity; automated checks cover objective contracts.
 */
export type CanonImprovisationKey =
  | "OPEN_GAP"
  | "CREATOR_CANON"
  | "USER_CANON"
  | "EXPLICIT_NEGATION"
  | "SOFT_CONTINUITY";

export const CANON_PRESERVING_IMPROVISATION_MATRIX: Record<
  CanonImprovisationKey,
  { case: string; expected: string }
> = {
  OPEN_GAP: { case: "설정 없는 과거를 자연스럽게 창작", expected: "PASS (creative invention, no canon conflict)" },
  CREATOR_CANON: { case: "creator가 과거를 정의", expected: "core creator canon preserved verbatim semantics" },
  USER_CANON: { case: "유저가 자기 과거를 정의", expected: "user canon preserved" },
  EXPLICIT_NEGATION: { case: "유저가 명시적으로 부정한 사실", expected: "opposite fact NOT created" },
  SOFT_CONTINUITY: { case: "모델이 이전 턴에서 만든 설정을 유저가 받아들임", expected: "consistent adoption as scene fact" },
};

/** RP A/B blind sample record corrections (E_impersonation re-eval). */
export const E_IMPERSONATION_RE_EVALUATION = {
  sampleA: {
    blindLabel: "Sample A (Pro)",
    runtimeMode: "interactive (A/B harness default; no delegation, no auto progression, no OOC opt-in)",
    classifier: {
      userDialogueLed: false,
      userActionLed: false,
      characterRejectionOfOrder: true,
      modelEthoUserLine: "none — quotes/echoes of the USER's own turn only",
    },
    subclassification: "VALID_STANDARD_INTERACTIVE",
  },
  sampleB: {
    blindLabel: "Sample B (Flash)",
    runtimeMode: "interactive (A/B harness default; standard COLLABORATIVE_INTERACTIVE assembly)",
    subclassification: "VALID_STANDARD_INTERACTIVE",
  },
  note:
    "E fixture는 유저 프롬브(actor ownership) 실험 프로브이지만, A/B 자체는 standard interactive 모드로 어셈블됨 — fixture label(user impersonation 방지)은 프로브이며 모드 위임은 없음. effective로 허용된 민수 패시지/거절 반응 외 민수 신규 발화/결정 없음 → AUTHORING_SCOPE_VIOLATION 없음.",
} as const;
