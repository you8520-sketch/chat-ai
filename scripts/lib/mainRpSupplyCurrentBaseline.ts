import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpOpenRouterRoutePolicy,
} from "@/lib/openRouterConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";
import type {
  MainRpSupplyRadarReport,
  SupplyComparison,
} from "./mainRpSupplyRadar";
import {
  MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
  buildDeterministicSupplyProbeTurns,
  executeOpenRouterSupplyProbe,
  processOpenRouterSupplySseLine,
  type SupplyLiveCandidate,
  type SupplyLiveCandidateResult,
  type SupplyLiveSelection,
  type SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";

export const MAIN_RP_SUPPLY_CURRENT_BASELINE_VERSION = 2;
export const MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS = 10;
export const MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD = 10;
export const MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS = 20;
export const MAIN_RP_SUPPLY_CURRENT_BASELINE_TIMEOUT_MS = 90_000;

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export type CurrentProcurementProvider = "cheaperinference" | "openrouter";

export type CurrentProcurementBaselinePlanEntry = {
  candidate: SupplyLiveCandidate;
  currentProvider: CurrentProcurementProvider;
  currentProviderName: string;
  currentProviderSlug: string;
  currentServiceTier: "flex" | null;
  estimatedPairCurrentRateUsd: number;
};

export type CurrentProcurementBaselinePlan = {
  selection: SupplyLiveSelection;
  entries: CurrentProcurementBaselinePlanEntry[];
  skipped: Array<{
    modelId: string;
    reason:
      | "current_procurement_missing"
      | "current_procurement_rate_missing"
      | "current_openrouter_route_policy_missing"
      | "current_openrouter_route_evidence_missing"
      | "current_baseline_budget_guard";
  }>;
  estimatedCurrentRateUsd: number;
  maxProviderGenerationCalls: number;
};

export type CurrentProcurementBaselineResult = {
  modelId: SupplyLiveCandidate["modelId"];
  currentProvider: CurrentProcurementProvider;
  currentProviderName: string;
  currentProviderSlug: string;
  currentServiceTier: "flex" | null;
  turns: SupplyLiveTurnResult[];
  providerGenerationCalls: number;
  livePairComplete: boolean;
  secondTurnCacheReadObserved: boolean;
  estimatedPairCurrentRateUsd: number;
};

export type SupplyTransportComparisonRow = {
  modelId: SupplyLiveCandidate["modelId"];
  candidateProviderName: string;
  candidateProviderSlug: string;
  candidateDeploymentServiceTier: "flex" | null;
  currentProvider: CurrentProcurementProvider;
  currentProviderName: string;
  currentProviderSlug: string;
  currentServiceTier: "flex" | null;
  candidatePairComplete: boolean;
  currentPairComplete: boolean;
  candidateSecondTurnCacheReadObserved: boolean;
  currentSecondTurnCacheReadObserved: boolean;
  candidateAverageTtftSeconds: number | null;
  currentAverageTtftSeconds: number | null;
  candidateAverageTotalSeconds: number | null;
  currentAverageTotalSeconds: number | null;
  candidateObservedBilledCostUsd: number | null;
  currentObservedBilledCostUsd: number | null;
  candidateObservedCostDeltaVsCurrentPercent: number | null;
  candidateEstimatedPairRawEndpointRateUsd: number;
  currentEstimatedPairRateUsd: number;
  marketRawEndpointRateDeltaVsCurrentPercent: number;
};

export type SupplyTransportComparisonReport = {
  version: number;
  generatedAt: string;
  providerGenerationCalls: number;
  maxProviderGenerationCalls: number;
  candidateGenerationCalls: number;
  currentBaselineGenerationCalls: number;
  rows: SupplyTransportComparisonRow[];
  notes: string[];
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function estimatePairUsd(inputPerM: number, outputPerM: number): number {
  return (
    2 *
    (inputPerM * 50_000 / 1_000_000 +
      outputPerM * 1_200 / 1_000_000)
  );
}

function currentOpenRouterEndpoint(input: {
  modelId: SupplyLiveCandidate["modelId"];
  comparisons: SupplyComparison[];
}): {
  providerName: string;
  providerSlug: string;
  serviceTier: "flex";
} | null {
  const route = resolveMainRpOpenRouterRoutePolicy(input.modelId);
  if (!route || route.provider.only.length !== 1) return null;
  const providerSlug = route.provider.only[0];
  const endpoint = input.comparisons.find((row) => {
    if (row.provider?.slug?.toLowerCase() !== providerSlug.toLowerCase()) {
      return false;
    }
    if (route.serviceTier !== "flex") return true;
    return `${row.providerName} ${row.providerTag ?? ""}`
      .toLowerCase()
      .includes("flex");
  });
  if (!endpoint) return null;
  return {
    providerName: endpoint.providerName,
    providerSlug,
    serviceTier: route.serviceTier,
  };
}

export function applyCurrentProcurementBaselineBudgetGuard(
  radar: MainRpSupplyRadarReport,
  selection: SupplyLiveSelection
): CurrentProcurementBaselinePlan {
  const entries: CurrentProcurementBaselinePlanEntry[] = [];
  const skipped: CurrentProcurementBaselinePlan["skipped"] = [];
  const plannedModelIds = new Set<SupplyLiveCandidate["modelId"]>();
  let estimatedCurrentRateUsd = 0;

  for (const candidate of selection.candidates) {
    if (plannedModelIds.has(candidate.modelId)) continue;
    const model = radar.models.find((row) => row.modelId === candidate.modelId);
    const baseline = model?.currentProcurement ?? null;
    if (!model || !baseline) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_procurement_missing",
      });
      continue;
    }

    const inputPerM = asNumber(baseline.inputUsdPerMillion);
    const outputPerM = asNumber(baseline.outputUsdPerMillion);
    if (inputPerM == null || outputPerM == null) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_procurement_rate_missing",
      });
      continue;
    }

    let currentProviderName = "CheaperInference";
    let currentProviderSlug = "cheaperinference";
    let currentServiceTier: "flex" | null = null;

    if (baseline.provider === "openrouter") {
      const route = resolveMainRpOpenRouterRoutePolicy(candidate.modelId);
      if (!route) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_policy_missing",
        });
        continue;
      }
      const evidence = currentOpenRouterEndpoint({
        modelId: candidate.modelId,
        comparisons: model.comparisons,
      });
      if (!evidence) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_evidence_missing",
        });
        continue;
      }
      currentProviderName = evidence.providerName;
      currentProviderSlug = evidence.providerSlug;
      currentServiceTier = evidence.serviceTier;

      if (candidate.deploymentServiceTier !== currentServiceTier) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_policy_missing",
        });
        continue;
      }
    }

    const estimate = estimatePairUsd(inputPerM, outputPerM);
    if (
      estimatedCurrentRateUsd + estimate >
      MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_ESTIMATED_USD
    ) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_baseline_budget_guard",
      });
      continue;
    }

    entries.push({
      candidate,
      currentProvider: baseline.provider,
      currentProviderName,
      currentProviderSlug,
      currentServiceTier,
      estimatedPairCurrentRateUsd: estimate,
    });
    plannedModelIds.add(candidate.modelId);
    estimatedCurrentRateUsd += estimate;
  }

  if (
    entries.length * 2 >
    MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS
  ) {
    throw new Error(
      "Current procurement baseline selection exceeded provider-call budget"
    );
  }

  const allowed = new Set(entries.map((entry) => entry.candidate.modelId));
  return {
    selection: {
      ...selection,
      candidates: selection.candidates.filter((candidate) =>
        allowed.has(candidate.modelId)
      ),
      skipped: [
        ...selection.skipped,
        ...skipped.map((row) => ({
          modelId: row.modelId as SupplyLiveCandidate["modelId"],
          providerName: "current-procurement",
          reason: row.reason,
        })),
      ],
      estimatedRawEndpointRateUsd:
        Math.round(
          selection.candidates
            .filter((candidate) => allowed.has(candidate.modelId))
            .reduce(
              (sum, candidate) =>
                sum + candidate.estimatedPairRawEndpointRateUsd,
              0
            ) *
            1_000_000
        ) / 1_000_000,
    },
    entries,
    skipped,
    estimatedCurrentRateUsd:
      Math.round(estimatedCurrentRateUsd * 1_000_000) / 1_000_000,
    maxProviderGenerationCalls:
      MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS,
  };
}

function buildCurrentCiRequest(input: {
  entry: CurrentProcurementBaselinePlanEntry;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): { body: JsonObject; url: string } {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.entry.candidate.modelId,
    caseData: input.turn,
    provider: "cheaperinference",
  });
  contextInput.targetResponseChars = MAIN_RP_SUPPLY_LIVE_TARGET_CHARS;
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: input.entry.candidate.modelId,
    targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
      sessionId: input.sessionId,
    },
    stream: true,
  });

  return {
    body: {
      ...(wire.requestBody as JsonObject),
      stream: true,
      stream_options: { include_usage: true },
    },
    url: buildCheaperInferenceChatCompletionsUrl({
      promptCacheSession: input.sessionId,
    }),
  };
}

function buildCurrentOpenRouterRequest(input: {
  entry: CurrentProcurementBaselinePlanEntry;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): { body: JsonObject; url: string } {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.entry.candidate.modelId,
    caseData: input.turn,
    provider: "openrouter",
  });
  contextInput.targetResponseChars = MAIN_RP_SUPPLY_LIVE_TARGET_CHARS;
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: input.entry.candidate.openRouterSlug,
    targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
    messageOpts: {
      transportProvider: "openrouter",
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
      sessionId: input.sessionId,
    },
    stream: true,
  });
  const body = {
    ...(wire.requestBody as JsonObject),
    stream: true,
    stream_options: { include_usage: true },
  };
  const provider = body.provider as
    | { only?: unknown; allow_fallbacks?: unknown; require_parameters?: unknown }
    | undefined;
  const only = Array.isArray(provider?.only) ? provider!.only : [];
  if (
    only.length !== 1 ||
    only[0] !== input.entry.currentProviderSlug ||
    body.service_tier !== input.entry.currentServiceTier
  ) {
    throw new Error(
      `Current OpenRouter baseline route drift for ${input.entry.candidate.modelId}`
    );
  }
  return { body, url: OPENROUTER_CHAT_COMPLETIONS_URL };
}

export function buildCurrentProcurementBaselineProbeRequest(input: {
  entry: CurrentProcurementBaselinePlanEntry;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): { body: JsonObject; url: string } {
  return input.entry.currentProvider === "cheaperinference"
    ? buildCurrentCiRequest(input)
    : buildCurrentOpenRouterRequest(input);
}

type StreamState = {
  text: string;
  finishReason: string | null;
  usage: JsonObject | null;
  resolvedModel: string | null;
  generationId: string | null;
  firstDeltaAtMs: number | null;
  sawDone: boolean;
};

function processChunk(
  chunk: string,
  state: StreamState,
  buffer: { value: string }
): void {
  buffer.value += chunk;
  const parts = buffer.value.split("\n");
  buffer.value = parts.pop() ?? "";
  for (const line of parts) processOpenRouterSupplySseLine(line, state);
}

function flush(
  decoder: TextDecoder,
  state: StreamState,
  buffer: { value: string }
): void {
  const tail = decoder.decode();
  if (tail) buffer.value += tail;
  if (buffer.value.trim()) processOpenRouterSupplySseLine(buffer.value, state);
  buffer.value = "";
}

async function executeCurrentCiProbe(input: {
  apiKey: string;
  body: JsonObject;
  url: string;
  turn: 1 | 2;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<SupplyLiveTurnResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const startedAtMs = now();
  const state: StreamState = {
    text: "",
    finishReason: null,
    usage: null,
    resolvedModel: null,
    generationId: null,
    firstDeltaAtMs: null,
    sawDone: false,
  };

  let httpStatus = 0;
  let error: string | null = null;
  let responseHeaders: Headers | null = null;

  try {
    const response = await fetchImpl(input.url, {
      method: "POST",
      headers: {
        ...buildCheaperInferenceHeaders(input.apiKey),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(MAIN_RP_SUPPLY_CURRENT_BASELINE_TIMEOUT_MS),
    });
    httpStatus = response.status;
    responseHeaders = response.headers;
    if (!response.ok) {
      error = (await response.text()).slice(0, 2_000);
    } else {
      const reader = response.body?.getReader();
      if (!reader) {
        error = "missing_stream_body";
      } else {
        const decoder = new TextDecoder();
        const buffer = { value: "" };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          processChunk(decoder.decode(value, { stream: true }), state, buffer);
        }
        flush(decoder, state, buffer);
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const endedAtMs = now();
  const totalSeconds = Math.max(0, (endedAtMs - startedAtMs) / 1000);
  const ttftSeconds =
    state.firstDeltaAtMs == null
      ? null
      : Math.max(0, (state.firstDeltaAtMs - startedAtMs) / 1000);
  const breakdown = parseCompatibleUsage({
    usage: state.usage,
    headers: responseHeaders,
    transportProvider: "cheaperinference",
  });
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
    providerReportedCostUsd:
      breakdown.cheaperInferenceBilledCostUsd ??
      breakdown.upstreamCostUsd ??
      null,
    providerMetadata: null,
    servedProviderMatch: null,
    error,
  };
}

function isComplete(turn: SupplyLiveTurnResult): boolean {
  return (
    turn.httpStatus === 200 &&
    !turn.error &&
    turn.text.trim().length > 0 &&
    turn.finishReason != null &&
    turn.sawDone
  );
}

function currentOpenRouterCandidate(
  entry: CurrentProcurementBaselinePlanEntry
): SupplyLiveCandidate {
  return {
    ...entry.candidate,
    providerName: entry.currentProviderName,
    providerSlug: entry.currentProviderSlug,
    rawEndpointRateDeltaVsCurrentProcurementPercent: 0,
    deploymentServiceTier: entry.currentServiceTier,
  };
}

export async function runCurrentProcurementBaselinePair(input: {
  entry: CurrentProcurementBaselinePlanEntry;
  sessionId: string;
  cheaperInferenceApiKey?: string | null;
  openRouterApiKey?: string | null;
  fetchImpl?: FetchLike;
}): Promise<CurrentProcurementBaselineResult> {
  const turns = buildDeterministicSupplyProbeTurns();
  const results: SupplyLiveTurnResult[] = [];

  for (let index = 0; index < turns.length; index += 1) {
    const request = buildCurrentProcurementBaselineProbeRequest({
      entry: input.entry,
      turn: turns[index]!,
      sessionId: input.sessionId,
    });

    let result: SupplyLiveTurnResult;
    if (input.entry.currentProvider === "cheaperinference") {
      if (!input.cheaperInferenceApiKey) {
        throw new Error("missing_cheaper_inference_benchmark_credential");
      }
      result = await executeCurrentCiProbe({
        apiKey: input.cheaperInferenceApiKey,
        body: request.body,
        url: request.url,
        turn: (index + 1) as 1 | 2,
        fetchImpl: input.fetchImpl,
      });
    } else {
      if (!input.openRouterApiKey) {
        throw new Error("missing_openrouter_supply_benchmark_credential");
      }
      result = await executeOpenRouterSupplyProbe({
        apiKey: input.openRouterApiKey,
        candidate: currentOpenRouterCandidate(input.entry),
        body: request.body,
        turn: (index + 1) as 1 | 2,
        fetchImpl: input.fetchImpl,
      });
    }

    results.push(result);
    if (!isComplete(result)) break;
  }

  const livePairComplete =
    results.length === 2 && results.every((turn) => isComplete(turn));
  const secondTurn = results.find((turn) => turn.turn === 2) ?? null;

  return {
    modelId: input.entry.candidate.modelId,
    currentProvider: input.entry.currentProvider,
    currentProviderName: input.entry.currentProviderName,
    currentProviderSlug: input.entry.currentProviderSlug,
    currentServiceTier: input.entry.currentServiceTier,
    turns: results,
    providerGenerationCalls: results.length,
    livePairComplete,
    secondTurnCacheReadObserved: (secondTurn?.cacheReadTokens ?? 0) > 0,
    estimatedPairCurrentRateUsd: input.entry.estimatedPairCurrentRateUsd,
  };
}

function average(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value != null);
  if (!measured.length) return null;
  return measured.reduce((sum, value) => sum + value, 0) / measured.length;
}

function sumMeasured(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value != null);
  return measured.length === values.length && measured.length > 0
    ? measured.reduce((sum, value) => sum + value, 0)
    : null;
}

function candidateBilledCost(turns: SupplyLiveTurnResult[]): number | null {
  return sumMeasured(
    turns.map((turn) => turn.providerMetadata?.totalCostUsd ?? null)
  );
}

function currentBilledCost(
  baseline: CurrentProcurementBaselineResult
): number | null {
  if (baseline.currentProvider === "openrouter") {
    return sumMeasured(
      baseline.turns.map(
        (turn) => turn.providerMetadata?.totalCostUsd ?? null
      )
    );
  }
  return sumMeasured(
    baseline.turns.map((turn) => turn.providerReportedCostUsd)
  );
}

function deltaPct(candidate: number | null, current: number | null): number | null {
  if (candidate == null || current == null || current <= 0) return null;
  return (candidate - current) / current;
}

export function buildSupplyTransportComparisonReport(input: {
  candidateResults: SupplyLiveCandidateResult[];
  currentResults: CurrentProcurementBaselineResult[];
  generatedAt?: string;
}): SupplyTransportComparisonReport {
  const rows: SupplyTransportComparisonRow[] = [];

  for (const candidateResult of input.candidateResults) {
    const baseline = input.currentResults.find(
      (row) => row.modelId === candidateResult.candidate.modelId
    );
    if (!baseline) continue;

    const candidateCost = candidateBilledCost(candidateResult.turns);
    const currentCost = currentBilledCost(baseline);

    rows.push({
      modelId: candidateResult.candidate.modelId,
      candidateProviderName: candidateResult.candidate.providerName,
      candidateProviderSlug: candidateResult.candidate.providerSlug,
      candidateDeploymentServiceTier:
        candidateResult.candidate.deploymentServiceTier,
      currentProvider: baseline.currentProvider,
      currentProviderName: baseline.currentProviderName,
      currentProviderSlug: baseline.currentProviderSlug,
      currentServiceTier: baseline.currentServiceTier,
      candidatePairComplete: candidateResult.livePairComplete,
      currentPairComplete: baseline.livePairComplete,
      candidateSecondTurnCacheReadObserved:
        candidateResult.secondTurnCacheReadObserved,
      currentSecondTurnCacheReadObserved:
        baseline.secondTurnCacheReadObserved,
      candidateAverageTtftSeconds: average(
        candidateResult.turns.map((turn) => turn.ttftSeconds)
      ),
      currentAverageTtftSeconds: average(
        baseline.turns.map((turn) => turn.ttftSeconds)
      ),
      candidateAverageTotalSeconds: average(
        candidateResult.turns.map((turn) => turn.totalSeconds)
      ),
      currentAverageTotalSeconds: average(
        baseline.turns.map((turn) => turn.totalSeconds)
      ),
      candidateObservedBilledCostUsd: candidateCost,
      currentObservedBilledCostUsd: currentCost,
      candidateObservedCostDeltaVsCurrentPercent: deltaPct(
        candidateCost,
        currentCost
      ),
      candidateEstimatedPairRawEndpointRateUsd:
        candidateResult.candidate.estimatedPairRawEndpointRateUsd,
      currentEstimatedPairRateUsd: baseline.estimatedPairCurrentRateUsd,
      marketRawEndpointRateDeltaVsCurrentPercent:
        candidateResult.candidate
          .rawEndpointRateDeltaVsCurrentProcurementPercent,
    });
  }

  const candidateCalls = input.candidateResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const currentCalls = input.currentResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const totalCalls = candidateCalls + currentCalls;
  if (totalCalls > MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS) {
    throw new Error("Combined supply comparison exceeded provider-call budget");
  }

  return {
    version: MAIN_RP_SUPPLY_CURRENT_BASELINE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    providerGenerationCalls: totalCalls,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
    candidateGenerationCalls: candidateCalls,
    currentBaselineGenerationCalls: currentCalls,
    rows,
    notes: [
      "This is a factual side-by-side transport/cache/cost comparison, not an automatic provider selection.",
      "Current baseline is the actual registry-owned procurement route: CheaperInference or OpenRouter.",
      "For current OpenRouter models, both baseline and candidate carry the production service tier exactly.",
      "Same-OpenRouter observed billed cost uses OpenRouter generation metadata total_cost on both sides.",
      "Cross-provider observed costs are retained as evidence but are not treated as automatically comparable procurement cash costs.",
      "Raw outputs remain review artifacts; no composite RP quality score is generated.",
    ],
  };
}

export function renderSupplyTransportComparisonMarkdown(
  report: SupplyTransportComparisonReport
): string {
  const lines = [
    "# Main RP Supply — Candidate vs Current Procurement",
    "",
    `- provider generation calls: **${report.providerGenerationCalls}/${report.maxProviderGenerationCalls}**`,
    `- candidate calls: ${report.candidateGenerationCalls}`,
    `- current baseline calls: ${report.currentBaselineGenerationCalls}`,
    "",
    "| Model | Candidate | Current route | Tier | Candidate TTFT | Current TTFT | Candidate total | Current total | Candidate cost | Current cost | Observed cost delta |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderName} | ${row.currentProviderName} | ${row.currentServiceTier ?? "default"} | ${row.candidateAverageTtftSeconds ?? "n/a"} | ${row.currentAverageTtftSeconds ?? "n/a"} | ${row.candidateAverageTotalSeconds ?? "n/a"} | ${row.currentAverageTotalSeconds ?? "n/a"} | ${row.candidateObservedBilledCostUsd ?? "n/a"} | ${row.currentObservedBilledCostUsd ?? "n/a"} | ${row.candidateObservedCostDeltaVsCurrentPercent == null ? "n/a" : (row.candidateObservedCostDeltaVsCurrentPercent * 100).toFixed(1) + "%"} |`
    );
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
