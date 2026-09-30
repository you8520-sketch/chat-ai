import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { OPENROUTER_CHAT_COMPLETIONS_URL, resolveMainRpOpenRouterRoutePolicy } from "@/lib/openRouterConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";
import {
  selectCurrentOpenRouterRouteEndpoint,
  type MainRpSupplyRadarReport,
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
export type CurrentBaselineProvider = "cheaperinference" | "openrouter";

export type CurrentBaselinePlanEntry = {
  candidate: SupplyLiveCandidate;
  currentProvider: CurrentBaselineProvider;
  currentProviderName: string;
  currentProviderSlug: string | null;
  currentServiceTier: "flex" | null;
  estimatedPairCurrentRateUsd: number;
  openRouterRouteCandidate: SupplyLiveCandidate | null;
};

export type CurrentBaselinePlan = {
  selection: SupplyLiveSelection;
  entries: CurrentBaselinePlanEntry[];
  skipped: Array<{
    modelId: string;
    reason:
      | "current_procurement_baseline_missing"
      | "current_openrouter_route_policy_missing"
      | "current_openrouter_route_endpoint_missing"
      | "current_baseline_budget_guard";
  }>;
  estimatedCurrentRateUsd: number;
  maxProviderGenerationCalls: number;
};

export type CurrentBaselineResult = {
  modelId: SupplyLiveCandidate["modelId"];
  currentProvider: CurrentBaselineProvider;
  currentProviderName: string;
  currentProviderSlug: string | null;
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
  currentProvider: CurrentBaselineProvider;
  currentProviderName: string;
  currentProviderSlug: string | null;
  currentServiceTier: "flex" | null;
  candidatePairComplete: boolean;
  currentBaselinePairComplete: boolean;
  candidateSecondTurnCacheReadObserved: boolean;
  currentBaselineSecondTurnCacheReadObserved: boolean;
  candidateAverageTtftSeconds: number | null;
  currentBaselineAverageTtftSeconds: number | null;
  candidateAverageTotalSeconds: number | null;
  currentBaselineAverageTotalSeconds: number | null;
  candidateObservedProviderCostUsd: number | null;
  currentBaselineObservedProviderCostUsd: number | null;
  candidateEstimatedPairRawEndpointRateUsd: number;
  currentBaselineEstimatedPairRateUsd: number;
  marketRawEndpointRateDeltaVsCurrentBaselinePercent: number;
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
  return 2 * (
    inputPerM * 50_000 / 1_000_000 +
    outputPerM * 1_200 / 1_000_000
  );
}

function currentOpenRouterRouteCandidate(input: {
  model: MainRpSupplyRadarReport["models"][number];
  candidate: SupplyLiveCandidate;
}): {
  providerName: string;
  providerSlug: string;
  serviceTier: "flex" | null;
  candidate: SupplyLiveCandidate;
} | null {
  const route = resolveMainRpOpenRouterRoutePolicy(input.candidate.modelId);
  if (!route) return null;
  const endpoint = selectCurrentOpenRouterRouteEndpoint(
    input.candidate.modelId,
    input.model.comparisons
  );
  const providerSlug = route.provider.only[0] ?? null;
  if (!endpoint || !providerSlug) return null;
  return {
    providerName: endpoint.providerName,
    providerSlug,
    serviceTier: route.serviceTier,
    candidate: {
      ...input.candidate,
      providerName: endpoint.providerName,
      providerSlug,
      quantization: endpoint.quantization,
      rawEndpointRateDeltaVsCurrentProcurementPercent: 0,
      inputUsdPerMillion:
        endpoint.inputUsdPerMillion ?? input.candidate.inputUsdPerMillion,
      outputUsdPerMillion:
        endpoint.outputUsdPerMillion ?? input.candidate.outputUsdPerMillion,
      cacheReadUsdPerMillion: endpoint.cacheReadUsdPerMillion,
      marketLatencyP50SecondsLast30m:
        endpoint.latencyP50SecondsLast30m ??
        input.candidate.marketLatencyP50SecondsLast30m,
      marketThroughputP50TokensPerSecondLast30m:
        endpoint.throughputP50TokensPerSecondLast30m ??
        input.candidate.marketThroughputP50TokensPerSecondLast30m,
      marketUptimeLast1dPercent:
        endpoint.uptimeLast1dPercent ??
        input.candidate.marketUptimeLast1dPercent,
      marketUptimeLast30mPercent:
        endpoint.uptimeLast30mPercent ??
        input.candidate.marketUptimeLast30mPercent,
    },
  };
}

export function applyCurrentBaselineBudgetGuard(
  radar: MainRpSupplyRadarReport,
  selection: SupplyLiveSelection
): CurrentBaselinePlan {
  const entries: CurrentBaselinePlanEntry[] = [];
  const skipped: CurrentBaselinePlan["skipped"] = [];
  const plannedModelIds = new Set<SupplyLiveCandidate["modelId"]>();
  let estimatedCurrentRateUsd = 0;

  for (const candidate of selection.candidates) {
    if (plannedModelIds.has(candidate.modelId)) continue;
    const model = radar.models.find((row) => row.modelId === candidate.modelId);
    const procurement = model?.currentProcurement ?? null;
    const inputPerM = asNumber(procurement?.inputUsdPerMillion);
    const outputPerM = asNumber(procurement?.outputUsdPerMillion);
    if (!model || !procurement || inputPerM == null || outputPerM == null) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_procurement_baseline_missing",
      });
      continue;
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

    if (procurement.provider === "openrouter") {
      const route = resolveMainRpOpenRouterRoutePolicy(candidate.modelId);
      if (!route) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_policy_missing",
        });
        continue;
      }
      const current = currentOpenRouterRouteCandidate({ model, candidate });
      if (!current) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_endpoint_missing",
        });
        continue;
      }
      entries.push({
        candidate,
        currentProvider: "openrouter",
        currentProviderName: current.providerName,
        currentProviderSlug: current.providerSlug,
        currentServiceTier: current.serviceTier,
        estimatedPairCurrentRateUsd: estimate,
        openRouterRouteCandidate: current.candidate,
      });
    } else {
      entries.push({
        candidate,
        currentProvider: "cheaperinference",
        currentProviderName: "CheaperInference",
        currentProviderSlug: null,
        currentServiceTier: null,
        estimatedPairCurrentRateUsd: estimate,
        openRouterRouteCandidate: null,
      });
    }
    plannedModelIds.add(candidate.modelId);
    estimatedCurrentRateUsd += estimate;
  }

  if (
    entries.length * 2 >
    MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS
  ) {
    throw new Error("Current baseline selection exceeded provider-call budget");
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
          providerName: "current-production-route",
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
            ) * 1_000_000
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

export function buildCurrentBaselineProbeRequest(input: {
  entry: CurrentBaselinePlanEntry;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): { body: JsonObject; url: string } {
  const provider = input.entry.currentProvider;
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.entry.candidate.modelId,
    caseData: input.turn,
    provider,
  });
  contextInput.targetResponseChars = MAIN_RP_SUPPLY_LIVE_TARGET_CHARS;
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId:
      provider === "openrouter"
        ? input.entry.candidate.openRouterSlug
        : input.entry.candidate.modelId,
    targetResponseChars: MAIN_RP_SUPPLY_LIVE_TARGET_CHARS,
    messageOpts: {
      transportProvider: provider,
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
    url:
      provider === "openrouter"
        ? OPENROUTER_CHAT_COMPLETIONS_URL
        : buildCheaperInferenceChatCompletionsUrl({
            promptCacheSession: input.sessionId,
          }),
  };
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

async function executeCurrentCheaperInferenceBaselineProbe(input: {
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
      breakdown.cheaperInferenceBilledCostUsd ?? breakdown.upstreamCostUsd ?? null,
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

export async function runCurrentBaselinePair(input: {
  openRouterApiKey: string;
  cheaperInferenceApiKey?: string | null;
  entry: CurrentBaselinePlanEntry;
  sessionId: string;
  fetchImpl?: FetchLike;
}): Promise<CurrentBaselineResult> {
  const turns = buildDeterministicSupplyProbeTurns();
  const results: SupplyLiveTurnResult[] = [];

  for (let index = 0; index < turns.length; index += 1) {
    const request = buildCurrentBaselineProbeRequest({
      entry: input.entry,
      turn: turns[index]!,
      sessionId: input.sessionId,
    });

    let result: SupplyLiveTurnResult;
    if (input.entry.currentProvider === "openrouter") {
      const routeCandidate = input.entry.openRouterRouteCandidate;
      if (!routeCandidate) {
        throw new Error("current_openrouter_route_candidate_missing");
      }
      result = await executeOpenRouterSupplyProbe({
        apiKey: input.openRouterApiKey,
        candidate: routeCandidate,
        body: request.body,
        turn: (index + 1) as 1 | 2,
        fetchImpl: input.fetchImpl,
      });
    } else {
      const apiKey = input.cheaperInferenceApiKey?.trim();
      if (!apiKey) {
        throw new Error("missing_cheaper_inference_benchmark_credential");
      }
      result = await executeCurrentCheaperInferenceBaselineProbe({
        apiKey,
        body: request.body,
        url: request.url,
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

function observedCost(turns: SupplyLiveTurnResult[]): number | null {
  const costs = turns
    .map((turn) => turn.providerReportedCostUsd)
    .filter((value): value is number => value != null);
  return costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
}

export function buildSupplyTransportComparisonReport(input: {
  candidateResults: SupplyLiveCandidateResult[];
  currentBaselineResults: CurrentBaselineResult[];
  generatedAt?: string;
}): SupplyTransportComparisonReport {
  const rows: SupplyTransportComparisonRow[] = [];

  for (const candidateResult of input.candidateResults) {
    const baseline = input.currentBaselineResults.find(
      (row) => row.modelId === candidateResult.candidate.modelId
    );
    if (!baseline) continue;
    rows.push({
      modelId: candidateResult.candidate.modelId,
      candidateProviderName: candidateResult.candidate.providerName,
      candidateProviderSlug: candidateResult.candidate.providerSlug,
      currentProvider: baseline.currentProvider,
      currentProviderName: baseline.currentProviderName,
      currentProviderSlug: baseline.currentProviderSlug,
      currentServiceTier: baseline.currentServiceTier,
      candidatePairComplete: candidateResult.livePairComplete,
      currentBaselinePairComplete: baseline.livePairComplete,
      candidateSecondTurnCacheReadObserved:
        candidateResult.secondTurnCacheReadObserved,
      currentBaselineSecondTurnCacheReadObserved:
        baseline.secondTurnCacheReadObserved,
      candidateAverageTtftSeconds: average(
        candidateResult.turns.map((turn) => turn.ttftSeconds)
      ),
      currentBaselineAverageTtftSeconds: average(
        baseline.turns.map((turn) => turn.ttftSeconds)
      ),
      candidateAverageTotalSeconds: average(
        candidateResult.turns.map((turn) => turn.totalSeconds)
      ),
      currentBaselineAverageTotalSeconds: average(
        baseline.turns.map((turn) => turn.totalSeconds)
      ),
      candidateObservedProviderCostUsd: observedCost(candidateResult.turns),
      currentBaselineObservedProviderCostUsd: observedCost(baseline.turns),
      candidateEstimatedPairRawEndpointRateUsd:
        candidateResult.candidate.estimatedPairRawEndpointRateUsd,
      currentBaselineEstimatedPairRateUsd:
        baseline.estimatedPairCurrentRateUsd,
      marketRawEndpointRateDeltaVsCurrentBaselinePercent:
        candidateResult.candidate.rawEndpointRateDeltaVsCurrentProcurementPercent,
    });
  }

  const candidateCalls = input.candidateResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const currentBaselineCalls = input.currentBaselineResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const totalCalls = candidateCalls + currentBaselineCalls;
  if (totalCalls > MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS) {
    throw new Error("Combined supply comparison exceeded provider-call budget");
  }

  return {
    version: MAIN_RP_SUPPLY_CURRENT_BASELINE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    providerGenerationCalls: totalCalls,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
    candidateGenerationCalls: candidateCalls,
    currentBaselineGenerationCalls: currentBaselineCalls,
    rows,
    notes: [
      "This is a factual side-by-side transport/cache comparison against the actual current production procurement route.",
      "OpenRouter current baselines preserve the canonical provider pin and production service_tier.",
      "CheaperInference current baselines use the dedicated benchmark credential when that model is currently routed through CheaperInference.",
      "Candidate raw endpoint-rate estimates exclude OpenRouter account/platform fee interpretation.",
      "Two calls per side are not a statistical reliability sample. Market uptime metrics and durable history remain the stability owners.",
      "Raw outputs remain review artifacts; no composite RP quality score is generated.",
    ],
  };
}

export function renderSupplyTransportComparisonMarkdown(
  report: SupplyTransportComparisonReport
): string {
  const lines = [
    "# Main RP Supply — Candidate vs Current Production",
    "",
    `- provider generation calls: **${report.providerGenerationCalls}/${report.maxProviderGenerationCalls}**`,
    `- candidate calls: ${report.candidateGenerationCalls}`,
    `- current baseline calls: ${report.currentBaselineGenerationCalls}`,
    "",
    "| Model | Candidate | Current route | Candidate TTFT avg | Current TTFT avg | Candidate total avg | Current total avg | Candidate cache T2 | Current cache T2 | Candidate raw pair est. | Current pair est. |",
    "|---|---|---|---:|---:|---:|---:|---|---|---:|---:|",
  ];
  for (const row of report.rows) {
    const currentRoute =
      row.currentProvider === "openrouter"
        ? `${row.currentProviderName} / ${row.currentProviderSlug ?? "unknown"} / serviceTier=${row.currentServiceTier ?? "default"}`
        : row.currentProviderName;
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderName} | ${currentRoute} | ${row.candidateAverageTtftSeconds ?? "n/a"} | ${row.currentBaselineAverageTtftSeconds ?? "n/a"} | ${row.candidateAverageTotalSeconds ?? "n/a"} | ${row.currentBaselineAverageTotalSeconds ?? "n/a"} | ${row.candidateSecondTurnCacheReadObserved} | ${row.currentBaselineSecondTurnCacheReadObserved} | $${row.candidateEstimatedPairRawEndpointRateUsd.toFixed(4)} | $${row.currentBaselineEstimatedPairRateUsd.toFixed(4)} |`
    );
  }
  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
