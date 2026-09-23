/**
 * Opus 5.5 pricing/cache evidence ledger — read-only audit artifacts.
 * Does not upgrade UNVERIFIED observations to verified production semantics.
 */

import { CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL } from "@/lib/chatModels";

/** GET https://api.cheaperinference.com/v1/models → claude-opus-5.5 pricing block (2026-09-23 fetch). */
export const OPUS55_CI_CATALOG_EVIDENCE = {
  modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  source: "cheaperinference_get_v1_models",
  fields: {
    input_per_million: 2.8,
    output_per_million: 14,
    cache_read_input_per_million: 2.8,
    cache_write_input_per_million: 2.8,
    list_input_per_million: 4,
    list_output_per_million: 20,
    discount_percent: 30,
  },
  note:
    "Catalog lists cache read/write USD/M equal to effective input — not Anthropic list cache read $0.20/M. Runtime cache hit/miss not verified for Opus 5.5.",
} as const;

/** Anthropic official list reference (PRODUCT billing reference semantic). */
export const OPUS55_ANTHROPIC_OFFICIAL_REFERENCE = {
  inputUsdPerMillion: 4,
  outputUsdPerMillion: 20,
  cacheWrite5mUsdPerMillion: 5,
  cacheReadUsdPerMillion: 0.2,
} as const;

export type Opus55CachePathStageStatus = "VERIFIED" | "UNVERIFIED" | "NOT_APPLICABLE";

export type Opus55CachePathAuditRow = {
  stage: string;
  status: Opus55CachePathStageStatus;
  notes: string;
};

/** Code-path audit — not a runtime provider proof for Opus 5.5. */
export const OPUS55_CACHE_PATH_AUDIT: readonly Opus55CachePathAuditRow[] = [
  {
    stage: "Prompt assembly → cache_control breakpoints",
    status: "VERIFIED",
    notes:
      "openRouterCache.ts + openRouterAdult.applyCacheAndPrefillForTransport applies ephemeral cache_control to CheaperInference Anthropic models (isAnthropicModel includes claude-opus-5.5).",
  },
  {
    stage: "CheaperInference request body (cache_control passthrough)",
    status: "UNVERIFIED",
    notes:
      "No Opus 5.5-specific captured request/response fixture in repo; Opus 5 passthrough not fully proven historically.",
  },
  {
    stage: "CI response usage cache_read / cache_write fields",
    status: "UNVERIFIED",
    notes: "No production Opus 5.5 turn usage sample in repo.",
  },
  {
    stage: "Sequential cache hit evidence",
    status: "UNVERIFIED",
    notes: "No A/B consecutive-turn Opus 5.5 cache hit proof in this pass.",
  },
  {
    stage: "Cache hit → procurement cost decrease",
    status: "UNVERIFIED",
    notes:
      "CI catalog prices cache_read at $2.80/M (same as input) — catalog alone does not prove margin improvement from hits.",
  },
];

export type Opus55MarketBenchmarkKind =
  | "EXACT_OBSERVED"
  | "HYPOTHETICAL_SCENARIO"
  | "USER_PERCEIVED_REFERENCE";

export type Opus55MarketBenchmark = {
  id: string;
  label: string;
  kind: Opus55MarketBenchmarkKind;
  inputTokens: number | null;
  outputTokens: number | null;
  outputChars: number | null;
  observedUserCostKrw: number | null;
  observedUserPoints: number | null;
  notes: string;
};

export const OPUS55_MARKET_BENCHMARKS: readonly Opus55MarketBenchmark[] = [
  {
    id: "elin_opus55_a",
    label: "ELIN AI Opus 5.5",
    kind: "EXACT_OBSERVED",
    inputTokens: 73_763,
    outputTokens: 5_334,
    outputChars: null,
    observedUserCostKrw: 729.6,
    observedUserPoints: null,
    notes: "Observed user cost ~729.6 KRW; TTFT 8.80s; total generation 77.66s.",
  },
  {
    id: "tpot_opus5_observed",
    label: "T-POT Claude Opus 5",
    kind: "EXACT_OBSERVED",
    inputTokens: 58_654,
    outputTokens: 4_644,
    outputChars: 4_338,
    observedUserCostKrw: null,
    observedUserPoints: 921,
    notes: "Observed 921P; reasoning 0 tokens.",
  },
  {
    id: "tpot_opus55_hypothetical",
    label: "T-POT hypothetical Opus 5.5",
    kind: "HYPOTHETICAL_SCENARIO",
    inputTokens: 58_654,
    outputTokens: 4_644,
    outputChars: 4_338,
    observedUserCostKrw: null,
    observedUserPoints: 736.8,
    notes: "921P × 0.8 — NOT OBSERVED; assumes proportional pass-through of Anthropic list 20% cut.",
  },
  {
    id: "crack_perceived",
    label: "CRACK perceived price",
    kind: "USER_PERCEIVED_REFERENCE",
    inputTokens: null,
    outputTokens: null,
    outputChars: 4_360,
    observedUserCostKrw: null,
    observedUserPoints: 523,
    notes: "Token breakdown UNKNOWN — not an exact token-cost benchmark.",
  },
];

/** Published PRODUCT engine: margin on Anthropic list billing reference (not CI procurement). */
export const OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES = [0.35, 0.4, 0.45] as const;

/** @deprecated renamed — use OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES */
export const OPUS55_COMMERCIAL_MARGIN_CANDIDATES = OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES;

/** Pre-live commercial decision: margin on CI no-cache procurement (read-only inverse calculator). */
export const OPUS55_REALIZED_PROCUREMENT_MARGIN_CANDIDATES = [
  { label: "AGGRESSIVE" as const, targetRealizedGrossMargin: 0.3 },
  { label: "BALANCED" as const, targetRealizedGrossMargin: 0.35 },
  { label: "SAFE" as const, targetRealizedGrossMargin: 0.4 },
] as const;

export const OPUS55_PRODUCT_TARGET_MARGIN_SEMANTICS = {
  formula:
    "standardUserChargeKrw = roundKrwTenths(roundKrwTenths(billingReferenceCostUsd × fx) / (1 - targetMargin))",
  billingReference:
    "Anthropic list input/output on standardInputTokens + billableOutputTokens (publishedUserCharge.ts)",
  notEqualTo:
    "CI no-cache procurement gross margin — use REALIZED_PROCUREMENT_MARGIN_CANDIDATES for that meaning.",
} as const;

export const OPUS55_REALIZED_PROCUREMENT_MARGIN_SEMANTICS = {
  formula:
    "requiredUserChargeKrwRaw = ciNoCacheProcurementKrw / (1 - targetRealizedGrossMargin); finalUserChargeKrw = roundKrwTenths(raw); finalPoints = ceilPublishedChargePoints(finalUserChargeKrw)",
  procurementBase: "resolveProcurementCostFromCatalog with CI catalog input $2.80/M output $14/M, cache buckets 0",
  roundingOwner: "publishedChargeRounding.ts (published_points_v1)",
} as const;

export type Opus55RuntimeContractProbeStatus =
  | "NOT_RUN"
  | "COMPLETED"
  | "RUNTIME_PROOF_BLOCKED";

export type Opus55RuntimeContractProbeResult = {
  status: Opus55RuntimeContractProbeStatus;
  attemptedAt: string | null;
  reasoning: {
    httpStatus: number | null;
    rejectedFields: string[] | null;
    responseReasoningTokens: number | null;
    notes: string;
  };
  cache: {
    cacheTransportWorks: boolean | null;
    cacheHitWorks: boolean | null;
    cacheBillingSavingWorks: boolean | null;
    firstUsage: Record<string, unknown> | null;
    secondUsage: Record<string, unknown> | null;
    firstBilledUsd: number | null;
    secondBilledUsd: number | null;
    notes: string;
  };
  blockReason: string | null;
};

/**
 * Snapshot from scripts/diagnose-opus55-contract-probe.ts (2026-09-23).
 * Minimal 2-turn probe — not production RP workload proof.
 */
export const OPUS55_RUNTIME_CONTRACT_PROBE: Opus55RuntimeContractProbeResult = {
  status: "COMPLETED",
  attemptedAt: "2026-09-23T08:27:54.028Z",
  reasoning: {
    httpStatus: 200,
    rejectedFields: null,
    responseReasoningTokens: null,
    notes:
      "CI accepted thinking:disabled + reasoning_effort:low + output_config.effort:low; no reasoning usage in response.",
  },
  cache: {
    cacheTransportWorks: true,
    cacheHitWorks: false,
    cacheBillingSavingWorks: null,
    firstUsage: {
      prompt_tokens: 506,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    secondUsage: {
      prompt_tokens: 519,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    firstBilledUsd: null,
    secondBilledUsd: null,
    notes:
      "Minimal prefix probe: CACHE_TRANSPORT_WORKS (cache_control sent); CACHE_HIT_WORKS false (cached_tokens=0 both turns); billed USD absent on response — CACHE_BILLING_SAVING UNVERIFIED.",
  },
  blockReason: null,
};

export type Opus55TriStateProof = "WORKS" | "DOES_NOT_WORK" | "UNVERIFIED";

export const OPUS55_CACHE_RUNTIME_CLASSIFICATION: {
  cacheTransport: Opus55TriStateProof;
  cacheHit: Opus55TriStateProof;
  cacheBillingSaving: Opus55TriStateProof;
  summary: string;
} = {
  cacheTransport: "WORKS",
  cacheHit: "DOES_NOT_WORK",
  cacheBillingSaving: "UNVERIFIED",
  summary:
    "Minimal probe sent cache_control; no cache_read observed. Billing saving not proven (no billed USD on response; catalog read rate = input). Production-scale: UNVERIFIED.",
};

export const OPUS55_COMMERCIAL_WORKLOADS = {
  elin: { promptTokens: 73_763, outputTokens: 5_334, benchmarkId: "elin_opus55_a" },
  tpot: { promptTokens: 58_654, outputTokens: 4_644, benchmarkId: "tpot_opus5_observed" },
} as const;

/** CheaperInference chat-completions request fields — Opus 5.5-specific upstream proof UNVERIFIED. */
export const OPUS55_REASONING_CONTRACT_AUDIT = {
  requestFields: {
    thinking: { type: "disabled" as const },
    reasoning_effort: "low" as const,
    output_config: { effort: "low" as const },
  },
  inheritedFrom: "claude-opus-5 applyCheaperInferenceModelReasoningPolicy branch",
  opus55DirectProof: "UNVERIFIED",
  notes:
    "Matches existing Opus 5 CI adapter shape. No captured Opus 5.5 request proving upstream acceptance/ignore behavior.",
} as const;
