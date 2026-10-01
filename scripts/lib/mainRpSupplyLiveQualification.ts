import { executeCompatibleSupplyProbe } from "./compatibleSupplyProbe";
export { processCompatibleSupplySseLine as processOpenRouterSupplySseLine } from "./compatibleSupplyProbe";
import {
  MAIN_RP_MODEL_IDS,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveMainRpOpenRouterRoutePolicy,
} from "@/lib/openRouterConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationContextInput,
  loadCanonicalRpQualificationFixture,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";
import { buildActiveRpModelQualificationPacket } from "./rpModelQualificationPacket";
import type {
  MainRpSupplyRadarReport,
  SupplyComparison,
} from "./mainRpSupplyRadar";

export const MAIN_RP_SUPPLY_LIVE_QUALIFICATION_VERSION = 1;
export const MAIN_RP_SUPPLY_LIVE_MAX_CANDIDATES = 5;
export const MAIN_RP_SUPPLY_LIVE_MAX_CANDIDATES_PER_MODEL = 3;
export const MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS = 10;
export const MAIN_RP_SUPPLY_LIVE_MAX_RAW_RATE_ESTIMATE_USD = 5;
export const MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS = 0.1;
export const MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT = 99.8;
export const MAIN_RP_SUPPLY_LIVE_MAX_MARKET_LATENCY_P50_SECONDS = 3;
export const MAIN_RP_SUPPLY_LIVE_MIN_MARKET_THROUGHPUT_P50_TPS = 30;
export const MAIN_RP_SUPPLY_LIVE_TARGET_CHARS = 1200;
export const MAIN_RP_SUPPLY_LIVE_TIMEOUT_MS = 90_000;
export const OPENROUTER_GENERATION_METADATA_URL =
  "https://openrouter.ai/api/v1/generation";

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export type SupplyLiveControlEffort = "none" | "minimal" | "low";

export type SupplyLiveCandidate = {
  modelId: SelectedAI;
  openRouterSlug: string;
  providerName: string;
  providerSlug: string;
  quantization: string | null;
  rawEndpointRateDeltaVsCurrentProcurementPercent: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number | null;
  marketLatencyP50SecondsLast30m: number;
  marketThroughputP50TokensPerSecondLast30m: number;
  marketUptimeLast1dPercent: number;
  marketUptimeLast30mPercent: number;
  controlEffort: SupplyLiveControlEffort;
  excludeReasoning: boolean;
  estimatedPairRawEndpointRateUsd: number;
};

export type SupplyLiveSkippedCandidate = {
  modelId: SelectedAI;
  providerName: string;
  reason: string;
};

export type SupplyLiveSelection = {
  candidates: SupplyLiveCandidate[];
  skipped: SupplyLiveSkippedCandidate[];
  maxProviderGenerationCalls: number;
  estimatedRawEndpointRateUsd: number;
};

export type SupplyLiveGenerationMetadata = {
  providerName: string | null;
  model: string | null;
  latencySeconds: number | null;
  generationTimeSeconds: number | null;
  nativeTokensCached: number | null;
  totalCostUsd: number | null;
  upstreamInferenceCostUsd: number | null;
};

export type SupplyLiveTurnResult = {
  turn: 1 | 2;
  httpStatus: number;
  generationId: string | null;
  resolvedModel: string | null;
  finishReason: string | null;
  sawDone: boolean;
  text: string;
  visibleChars: number;
  ttftSeconds: number | null;
  totalSeconds: number;
  visibleCharsPerSecondAfterTtft: number | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  providerReportedCostUsd: number | null;
  providerMetadata: SupplyLiveGenerationMetadata | null;
  servedProviderMatch: boolean | null;
  error: string | null;
};

export type SupplyLiveCandidateResult = {
  candidate: SupplyLiveCandidate;
  turns: SupplyLiveTurnResult[];
  providerGenerationCalls: number;
  livePairComplete: boolean;
  secondTurnCacheReadObserved: boolean;
  transportStatus: "PAIR_COMPLETE" | "PAIR_INCOMPLETE";
  interpretation: string[];
};

export type MainRpSupplyLiveQualificationReport = {
  version: number;
  generatedAt: string;
  status: "OK" | "PARTIAL" | "NOT_RUN";
  providerGenerationCalls: number;
  maxProviderGenerationCalls: number;
  activeModelIds: readonly SelectedAI[];
  selection: SupplyLiveSelection;
  results: SupplyLiveCandidateResult[];
  notes: string[];
};

type CiControlSignature =
  | { ok: true; effort: SupplyLiveControlEffort; excludeReasoning: boolean }
  | { ok: false; reason: string };

function asObj(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function controlSignatureForModel(
  modelId: SelectedAI,
  packet: ReturnType<typeof buildActiveRpModelQualificationPacket>
): CiControlSignature {
  const model = packet.models.find((entry) => entry.modelId === modelId);
  const casePacket = model?.cases.find(
    (entry) => entry.caseId === "production_midchat_t1"
  );
  if (!casePacket) {
    return { ok: false, reason: "canonical_wire_controls_missing" };
  }
  const controls = casePacket.wireControls;

  if (modelId === "claude-opus-5.5") {
    if (
      asObj(controls.thinking)?.type === "disabled" &&
      asObj(controls.output_config)?.effort === "low" &&
      controls.reasoning_effort === "low"
    ) {
      return {
        ok: false,
        reason:
          "control_parity_unproven: CI Opus uses thinking disabled + output_config low; no automatic OpenRouter equivalence",
      };
    }
    return {
      ok: false,
      reason: "control_parity_unproven: current CI Opus controls drifted",
    };
  }

  if (modelId === "deepseek-v4.1-flash") {
    if (
      asObj(controls.thinking)?.type === "disabled" &&
      controls.reasoning_effort === "none"
    ) {
      return { ok: true, effort: "none", excludeReasoning: true };
    }
    return {
      ok: false,
      reason: "control_parity_unproven: current CI DeepSeek controls drifted",
    };
  }

  if (asObj(controls.reasoning)?.effort === "minimal") {
    return {
      ok: true,
      effort: "minimal",
      excludeReasoning: asObj(controls.reasoning)?.exclude === true,
    };
  }
  if (
    controls.reasoning_effort === "low" ||
    asObj(controls.reasoning)?.effort === "low"
  ) {
    return {
      ok: true,
      effort: "low",
      excludeReasoning: asObj(controls.reasoning)?.exclude === true,
    };
  }
  if (
    controls.reasoning_effort === "none" ||
    asObj(controls.reasoning)?.effort === "none"
  ) {
    return {
      ok: true,
      effort: "none",
      excludeReasoning: asObj(controls.reasoning)?.exclude !== false,
    };
  }
  return {
    ok: false,
    reason: "control_parity_unproven: unsupported CI reasoning controls",
  };
}

const OPENROUTER_ROUTING_ENVELOPE_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "session_id",
  "provider",
  "service_tier",
  "user",
  "metadata",
  "plugins",
  "transforms",
  "models",
  "route",
]);

export function resolveSupplyLiveRequiredProviderParameterKeys(
  candidate: SupplyLiveCandidate
): string[] {
  const [turn] = buildDeterministicSupplyProbeTurns();
  const body = buildSupplyProbeRequestBody({
    candidate,
    turn,
    sessionId: "supply-preflight",
  });
  return Object.keys(body)
    .filter((key) => !OPENROUTER_ROUTING_ENVELOPE_KEYS.has(key))
    .map((key) => key.toLowerCase())
    .sort();
}

function unsupportedProviderParameterKeys(
  endpoint: SupplyComparison,
  required: readonly string[]
): string[] {
  const supported = new Set(
    endpoint.supportedParameters.map((value) => value.toLowerCase())
  );
  return required.filter((key) => !supported.has(key));
}

function pairRawEndpointRateEstimate(endpoint: SupplyComparison): number | null {
  if (
    endpoint.inputUsdPerMillion == null ||
    endpoint.outputUsdPerMillion == null
  ) {
    return null;
  }
  // Conservative preflight only: two uncached calls, each up to ~50k prompt
  // tokens and ~1.2k completion tokens. This is NOT final cash procurement cost.
  return (
    2 *
    (endpoint.inputUsdPerMillion * 50_000 / 1_000_000 +
      endpoint.outputUsdPerMillion * 1_200 / 1_000_000)
  );
}

function factualCandidateReason(
  modelId: SelectedAI,
  endpoint: SupplyComparison,
  parity: CiControlSignature
): string | null {
  if (endpoint.lowerRawEndpointRateThanCurrentProcurement !== true) {
    return "raw_endpoint_rate_not_lower_than_current_procurement";
  }
  const delta = endpoint.rawEndpointRateDeltaVsCurrentProcurementPercent;
  if (delta == null || delta > -MAIN_RP_SUPPLY_LIVE_MIN_RAW_RATE_SAVINGS) {
    return "raw_endpoint_savings_below_10pct_screen";
  }
  if (endpoint.status !== 0) return "endpoint_status_not_ok";
  if (
    endpoint.uptimeLast1dPercent == null ||
    endpoint.uptimeLast1dPercent < MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT
  ) {
    return "uptime_1d_below_99_8_or_missing";
  }
  if (
    endpoint.uptimeLast30mPercent == null ||
    endpoint.uptimeLast30mPercent < MAIN_RP_SUPPLY_LIVE_MIN_UPTIME_PERCENT
  ) {
    return "uptime_30m_below_99_8_or_missing";
  }
  if (
    endpoint.latencyP50SecondsLast30m == null ||
    endpoint.latencyP50SecondsLast30m >
      MAIN_RP_SUPPLY_LIVE_MAX_MARKET_LATENCY_P50_SECONDS
  ) {
    return "market_latency_p50_above_3s_or_missing";
  }
  if (
    endpoint.throughputP50TokensPerSecondLast30m == null ||
    endpoint.throughputP50TokensPerSecondLast30m <
      MAIN_RP_SUPPLY_LIVE_MIN_MARKET_THROUGHPUT_P50_TPS
  ) {
    return "market_throughput_p50_below_30_tps_or_missing";
  }
  if (!endpoint.provider?.slug) return "provider_slug_missing";
  if (!endpoint.provider.privacyPolicyUrl) {
    return "provider_privacy_metadata_missing";
  }
  if (!parity.ok) return parity.reason;

  const estimate = pairRawEndpointRateEstimate(endpoint);
  if (estimate == null) return "raw_rate_estimate_unavailable";
  return null;
}

export function selectMainRpSupplyLiveCandidates(
  report: MainRpSupplyRadarReport
): SupplyLiveSelection {
  if (
    report.activeModelIds.length !== MAIN_RP_MODEL_IDS.length ||
    report.activeModelIds.some((id, index) => id !== MAIN_RP_MODEL_IDS[index])
  ) {
    throw new Error("Supply radar active-model registry drift");
  }

  const candidates: SupplyLiveCandidate[] = [];
  const skipped: SupplyLiveSkippedCandidate[] = [];
  let estimatedRawEndpointRateUsd = 0;
  const qualificationPacket = buildActiveRpModelQualificationPacket();
  const requiredProviderParametersByModel = new Map<SelectedAI, string[]>();

  for (const model of report.models) {
    const parity = controlSignatureForModel(model.modelId, qualificationPacket);
    const sorted = [...model.comparisons].sort((a, b) => {
      const ac =
        a.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
      const bc =
        b.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
      if (ac !== bc) return ac - bc;
      return a.providerName.localeCompare(b.providerName);
    });

    let selectedForModel = 0;
    for (const endpoint of sorted) {
      const reason = factualCandidateReason(model.modelId, endpoint, parity);
      if (reason) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason,
        });
        continue;
      }
      if (!parity.ok) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason: parity.reason,
        });
        continue;
      }
      const estimate = pairRawEndpointRateEstimate(endpoint)!;
      const candidate: SupplyLiveCandidate = {
        modelId: model.modelId,
        openRouterSlug: model.openRouterSlug,
        providerName: endpoint.providerName,
        providerSlug: endpoint.provider!.slug!,
        quantization: endpoint.quantization,
        rawEndpointRateDeltaVsCurrentProcurementPercent:
          endpoint.rawEndpointRateDeltaVsCurrentProcurementPercent!,
        inputUsdPerMillion: endpoint.inputUsdPerMillion!,
        outputUsdPerMillion: endpoint.outputUsdPerMillion!,
        cacheReadUsdPerMillion: endpoint.cacheReadUsdPerMillion,
        marketLatencyP50SecondsLast30m:
          endpoint.latencyP50SecondsLast30m!,
        marketThroughputP50TokensPerSecondLast30m:
          endpoint.throughputP50TokensPerSecondLast30m!,
        marketUptimeLast1dPercent: endpoint.uptimeLast1dPercent!,
        marketUptimeLast30mPercent: endpoint.uptimeLast30mPercent!,
        controlEffort: parity.effort,
        excludeReasoning: parity.excludeReasoning,
        estimatedPairRawEndpointRateUsd: estimate,
      };
      const requiredProviderParameters =
        requiredProviderParametersByModel.get(model.modelId) ??
        resolveSupplyLiveRequiredProviderParameterKeys(candidate);
      requiredProviderParametersByModel.set(
        model.modelId,
        requiredProviderParameters
      );
      const unsupported = unsupportedProviderParameterKeys(
        endpoint,
        requiredProviderParameters
      );
      if (unsupported.length > 0) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason: `required_request_parameters_not_advertised:${unsupported.join(",")}`,
        });
        continue;
      }

      if (
        estimatedRawEndpointRateUsd + estimate >
        MAIN_RP_SUPPLY_LIVE_MAX_RAW_RATE_ESTIMATE_USD
      ) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason: "monthly_raw_rate_budget_guard",
        });
        continue;
      }
      if (candidates.length >= MAIN_RP_SUPPLY_LIVE_MAX_CANDIDATES) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason: "monthly_candidate_count_guard",
        });
        continue;
      }
      if (
        selectedForModel >= MAIN_RP_SUPPLY_LIVE_MAX_CANDIDATES_PER_MODEL
      ) {
        skipped.push({
          modelId: model.modelId,
          providerName: endpoint.providerName,
          reason: "per_model_candidate_count_guard",
        });
        continue;
      }

      candidates.push(candidate);
      estimatedRawEndpointRateUsd += estimate;
      selectedForModel += 1;
    }

    if (selectedForModel === 0 && sorted.length === 0) {
      skipped.push({
        modelId: model.modelId,
        providerName: "none",
        reason: "no_market_endpoint_evidence",
      });
    }
  }

  if (candidates.length * 2 > MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS) {
    throw new Error("Supply live candidate selection exceeded provider-call budget");
  }

  return {
    candidates,
    skipped,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS,
    estimatedRawEndpointRateUsd:
      Math.round(estimatedRawEndpointRateUsd * 1_000_000) / 1_000_000,
  };
}

export function buildDeterministicSupplyProbeTurns(): [
  CanonicalQualificationCase,
  CanonicalQualificationCase,
] {
  const fixture = loadCanonicalRpQualificationFixture();
  const baseHistory = [
    { role: "user" as const, content: "[채팅 시작]" },
    { role: "assistant" as const, content: fixture.openingAssistant },
  ];
  return [
    {
      id: "production_midchat_t1",
      targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
      history: baseHistory,
      currentUserMessage: fixture.productionTurn1User,
      reviewFocus: [
        "transport latency/cache evidence only",
        "raw output retained for GPT/user RP review",
      ],
    },
    {
      id: "production_midchat_t1",
      targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
      history: [
        ...baseHistory,
        { role: "user" as const, content: fixture.productionTurn1User },
        {
          role: "assistant" as const,
          content: fixture.productionTurn1AssistantReference,
        },
      ],
      currentUserMessage: fixture.productionTurn2User,
      reviewFocus: [
        "deterministic frozen assistant reference preserves cross-provider comparability",
        "second-turn provider prompt-cache observation",
      ],
    },
  ];
}

export function applyCandidateControlAndProviderPin(
  body: JsonObject,
  candidate: SupplyLiveCandidate
): JsonObject {
  const next: JsonObject = {
    ...body,
    model: candidate.openRouterSlug,
    stream: true,
    stream_options: { include_usage: true },
    provider: {
      only: [candidate.providerSlug],
      allow_fallbacks: false,
      data_collection: "deny",
      require_parameters: true,
    },
    include_reasoning: false,
  };

  // Candidate qualification owns the alternate provider pin, but a model that
  // already runs through OpenRouter must keep the current production service
  // tier. Otherwise "same transport" promotion would compare default-tier
  // evidence against a Flex production route.
  const currentRoute = resolveMainRpOpenRouterRoutePolicy(candidate.modelId);
  if (currentRoute?.serviceTier) {
    next.service_tier = currentRoute.serviceTier;
  } else {
    delete next.service_tier;
  }
  delete next.reasoning_effort;
  next.reasoning = {
    effort: candidate.controlEffort,
    ...(candidate.excludeReasoning ? { exclude: true } : {}),
  };
  return next;
}

export function buildSupplyProbeRequestBody(input: {
  candidate: SupplyLiveCandidate;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): JsonObject {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.candidate.modelId,
    caseData: input.turn,
    provider: "openrouter",
  });
  contextInput.targetResponseChars = MAIN_RP_SUPPLY_LIVE_TARGET_CHARS;
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: input.candidate.openRouterSlug,
    targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
    messageOpts: {
      transportProvider: "openrouter",
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
      sessionId: input.sessionId,
    },
    stream: true,
  });
  return applyCandidateControlAndProviderPin(
    wire.requestBody as JsonObject,
    input.candidate
  );
}

export function buildSupplyLiveRequestHeaders(apiKey: string): Record<string, string> {
  return {
    ...buildOpenRouterHeaders(apiKey),
    Accept: "text/event-stream",
    "X-OpenRouter-Cache": "false",
    "X-OpenRouter-Metadata": "enabled",
  };
}

async function fetchGenerationMetadata(input: {
  generationId: string;
  apiKey: string;
  fetchImpl: FetchLike;
}): Promise<SupplyLiveGenerationMetadata | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      const url =
        `${OPENROUTER_GENERATION_METADATA_URL}?id=${encodeURIComponent(
          input.generationId
        )}`;
      const response = await input.fetchImpl(url, {
        method: "GET",
        headers: {
          ...buildOpenRouterHeaders(input.apiKey),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as unknown;
      const data = asObj(asObj(payload)?.data) ?? asObj(payload);
      if (!data) continue;
      return {
        providerName:
          typeof data.provider_name === "string" ? data.provider_name : null,
        model: typeof data.model === "string" ? data.model : null,
        latencySeconds: num(data.latency),
        generationTimeSeconds: num(data.generation_time),
        nativeTokensCached: num(
          data.native_tokens_cached ?? data.native_tokens_cache_read
        ),
        totalCostUsd: num(data.total_cost ?? data.usage),
        upstreamInferenceCostUsd: num(
          data.upstream_inference_cost ?? data.upstream_cost
        ),
      };
    } catch {
      // Metadata is corroborating evidence only. Never repeat generation.
    }
  }
  return null;
}

function providerMatches(
  candidate: SupplyLiveCandidate,
  metadata: SupplyLiveGenerationMetadata | null
): boolean | null {
  if (!metadata?.providerName) return null;
  const actual = metadata.providerName.trim().toLowerCase();
  return (
    actual === candidate.providerName.trim().toLowerCase() ||
    actual === candidate.providerSlug.trim().toLowerCase()
  );
}

export async function executeOpenRouterSupplyProbe(input: {
  apiKey: string;
  candidate: SupplyLiveCandidate;
  body: JsonObject;
  turn: 1 | 2;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<SupplyLiveTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const state = await executeCompatibleSupplyProbe({
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    headers: buildSupplyLiveRequestHeaders(input.apiKey),
    body: input.body,
    timeoutMs: MAIN_RP_SUPPLY_LIVE_TIMEOUT_MS,
    fetchImpl,
    now: input.now,
  });
  const { httpStatus, error, totalSeconds, ttftSeconds } = state;
  const breakdown = parseOpenRouterUsage(state.usage);
  const metadata =
    state.generationId && httpStatus === 200
      ? await fetchGenerationMetadata({
          generationId: state.generationId,
          apiKey: input.apiKey,
          fetchImpl,
        })
      : null;
  const activeGenerationSeconds =
    ttftSeconds == null ? null : Math.max(0.001, totalSeconds - ttftSeconds);

  return {
    turn: input.turn,
    httpStatus,
    generationId: state.generationId,
    resolvedModel: state.resolvedModel,
    finishReason: state.finishReason,
    sawDone: state.sawDone,
    text: state.text,
    visibleChars: state.text.length,
    ttftSeconds,
    totalSeconds,
    visibleCharsPerSecondAfterTtft:
      activeGenerationSeconds == null
        ? null
        : state.text.length / activeGenerationSeconds,
    promptTokens: breakdown.promptTokens,
    completionTokens: breakdown.completionTokens,
    reasoningTokens: breakdown.reasoningTokens,
    cacheReadTokens: breakdown.cacheReadTokens,
    cacheWriteTokens: breakdown.cacheWriteTokens,
    providerReportedCostUsd: breakdown.upstreamCostUsd ?? null,
    providerMetadata: metadata,
    servedProviderMatch: providerMatches(input.candidate, metadata),
    error,
  };
}

function turnComplete(turn: SupplyLiveTurnResult): boolean {
  return (
    turn.httpStatus === 200 &&
    !turn.error &&
    turn.text.trim().length > 0 &&
    turn.finishReason != null &&
    turn.sawDone
  );
}

export async function runOpenRouterSupplyCandidatePair(input: {
  apiKey: string;
  candidate: SupplyLiveCandidate;
  sessionId: string;
  fetchImpl?: FetchLike;
}): Promise<SupplyLiveCandidateResult> {
  const turns = buildDeterministicSupplyProbeTurns();
  const results: SupplyLiveTurnResult[] = [];

  for (let index = 0; index < turns.length; index += 1) {
    const body = buildSupplyProbeRequestBody({
      candidate: input.candidate,
      turn: turns[index]!,
      sessionId: input.sessionId,
    });
    const result = await executeOpenRouterSupplyProbe({
      apiKey: input.apiKey,
      candidate: input.candidate,
      body,
      turn: (index + 1) as 1 | 2,
      fetchImpl: input.fetchImpl,
    });
    results.push(result);
    // No retry/fallback generation. A failed first call still leaves factual
    // evidence, but the pair stops to preserve the bounded spend contract.
    if (!turnComplete(result)) break;
  }

  const livePairComplete =
    results.length === 2 && results.every((turn) => turnComplete(turn));
  const secondTurn = results.find((turn) => turn.turn === 2) ?? null;
  return {
    candidate: input.candidate,
    turns: results,
    providerGenerationCalls: results.length,
    livePairComplete,
    secondTurnCacheReadObserved: (secondTurn?.cacheReadTokens ?? 0) > 0,
    transportStatus: livePairComplete ? "PAIR_COMPLETE" : "PAIR_INCOMPLETE",
    interpretation: [
      "PAIR_COMPLETE is transport evidence, not an RP quality score.",
      "Two live calls are not a statistical uptime sample; use the radar's 1d/30m uptime metrics for market stability.",
      "Raw outputs must be reviewed by GPT/user under the site's current RP authoring policy before any supplier decision.",
      "X-OpenRouter-Cache=false disables response replay; observed cached tokens refer to provider prompt caching where reported.",
    ],
  };
}

export function buildSupplyLiveReport(input: {
  selection: SupplyLiveSelection;
  results: SupplyLiveCandidateResult[];
  generatedAt?: string;
  notRunReason?: string | null;
}): MainRpSupplyLiveQualificationReport {
  const calls = input.results.reduce(
    (sum, result) => sum + result.providerGenerationCalls,
    0
  );
  if (calls > MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS) {
    throw new Error("Supply live report exceeded provider-call budget");
  }
  const selectedModelIds = [
    ...new Set(input.selection.candidates.map((candidate) => candidate.modelId)),
  ];
  const completedModelIds = new Set(
    input.results
      .filter((result) => result.livePairComplete)
      .map((result) => result.candidate.modelId)
  );
  const status: MainRpSupplyLiveQualificationReport["status"] =
    input.notRunReason
      ? "NOT_RUN"
      : selectedModelIds.length === 0
        ? "OK"
        : selectedModelIds.every((modelId) => completedModelIds.has(modelId))
          ? "OK"
          : "PARTIAL";

  return {
    version: MAIN_RP_SUPPLY_LIVE_QUALIFICATION_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status,
    providerGenerationCalls: calls,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_LIVE_MAX_PROVIDER_CALLS,
    activeModelIds: MAIN_RP_MODEL_IDS,
    selection: input.selection,
    results: input.results,
    notes: [
      ...(input.notRunReason ? [`NOT_RUN: ${input.notRunReason}`] : []),
      "This is bounded supplier transport qualification, not automatic provider selection.",
      "No composite RP quality score is generated.",
      "OpenRouter endpoint raw rates exclude account/platform fee interpretation; final procurement economics remain a separate review.",
      "Candidates are ordered alternatives. Up to three endpoints per active model may be preselected, with at most two generation calls per tested candidate and a global 10-call candidate budget.",
      "For models already routed through OpenRouter, candidate qualification preserves the production service_tier while replacing only the provider pin.",
      "Claude Opus 5.5 is skipped until CI/OpenRouter thinking/output control parity is proven.",
    ],
  };
}

export function renderSupplyLiveReportMarkdown(
  report: MainRpSupplyLiveQualificationReport
): string {
  const lines: string[] = [
    "# Main RP Supply Live Qualification",
    "",
    `- status: **${report.status}**`,
    `- provider generation calls: **${report.providerGenerationCalls}/${report.maxProviderGenerationCalls}**`,
    `- selected candidates: ${report.selection.candidates.length}`,
    `- tested candidates: ${report.results.length}`,
    `- estimated raw endpoint-rate spend before calls: ${report.selection.estimatedRawEndpointRateUsd.toFixed(4)}`,
    "",
  ];

  for (const result of report.results) {
    const c = result.candidate;
    lines.push(
      `## ${c.modelId} via ${c.providerName}`,
      "",
      `- provider slug: ${c.providerSlug}`,
      `- quantization: ${c.quantization ?? "unspecified"}`,
      `- market uptime 1d/30m: ${c.marketUptimeLast1dPercent}% / ${c.marketUptimeLast30mPercent}%`,
      `- market latency p50: ${c.marketLatencyP50SecondsLast30m}s`,
      `- market throughput p50: ${c.marketThroughputP50TokensPerSecondLast30m} tok/s`,
      `- raw endpoint-rate delta vs current procurement: ${(c.rawEndpointRateDeltaVsCurrentProcurementPercent * 100).toFixed(1)}%`,
      `- transport status: **${result.transportStatus}**`,
      `- second-turn cache read observed: ${result.secondTurnCacheReadObserved}`,
      ""
    );
    lines.push(
      "| turn | HTTP | TTFT s | total s | chars | cache read | cache write | served provider match |",
      "|---:|---:|---:|---:|---:|---:|---:|---|"
    );
    for (const turn of result.turns) {
      lines.push(
        `| ${turn.turn} | ${turn.httpStatus} | ${turn.ttftSeconds ?? "n/a"} | ${turn.totalSeconds.toFixed(3)} | ${turn.visibleChars} | ${turn.cacheReadTokens} | ${turn.cacheWriteTokens} | ${turn.servedProviderMatch ?? "unknown"} |`
      );
    }
    lines.push("");
  }

  if (report.selection.skipped.length) {
    lines.push("## Skipped evidence", "");
    for (const skipped of report.selection.skipped) {
      lines.push(
        `- ${skipped.modelId} / ${skipped.providerName}: ${skipped.reason}`
      );
    }
    lines.push("");
  }

  lines.push("## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
