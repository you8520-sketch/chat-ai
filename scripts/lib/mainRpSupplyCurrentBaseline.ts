import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpOpenRouterRoutePolicy,
} from "@/lib/openRouterConfig";
import { parseCompatibleUsage } from "@/lib/openRouterUsage";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCase,
} from "./rpModelQualificationFixture";
import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
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

export const MAIN_RP_SUPPLY_CURRENT_BASELINE_VERSION = 1;
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
  currentInputUsdPerMillion: number;
  currentOutputUsdPerMillion: number;
  estimatedPairCurrentRateUsd: number;
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
  currentBaselineProvider: CurrentBaselineProvider;
  currentBaselineProviderName: string;
  currentBaselineProviderSlug: string | null;
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

function estimateCurrentPairUsd(inputPerM: number, outputPerM: number): number {
  return 2 * (
    inputPerM * 50_000 / 1_000_000 +
    outputPerM * 1_200 / 1_000_000
  );
}

function currentOpenRouterEndpoint(input: {
  model: MainRpSupplyRadarReport["models"][number];
}): {
  providerName: string;
  providerSlug: string;
  serviceTier: "flex" | null;
} | null {
  const policy = resolveMainRpOpenRouterRoutePolicy(input.model.modelId);
  if (!policy) return null;
  const allowed = new Set(policy.provider.only.map((value) => value.toLowerCase()));
  const matching = input.model.comparisons
    .filter((row) => {
      const slug = row.provider?.slug?.toLowerCase() ?? "";
      if (!allowed.has(slug)) return false;
      if (policy.serviceTier !== "flex") return true;
      const tierEvidence =
        `${row.providerName} ${row.providerTag ?? ""}`.toLowerCase();
      return tierEvidence.includes("flex");
    })
    .sort((a, b) => {
      const ac = a.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
      const bc = b.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
      return ac - bc;
    });
  const row = matching[0];
  const slug = row?.provider?.slug;
  if (!row || !slug) return null;
  return {
    providerName: row.providerName,
    providerSlug: slug,
    serviceTier: policy.serviceTier ?? null,
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
    const current = model?.currentProcurement;
    const inputPerM = asNumber(current?.inputUsdPerMillion);
    const outputPerM = asNumber(current?.outputUsdPerMillion);
    if (!model || !current || inputPerM == null || outputPerM == null) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_procurement_baseline_missing",
      });
      continue;
    }

    let currentProviderName = "CheaperInference";
    let currentProviderSlug: string | null = null;
    let currentServiceTier: "flex" | null = null;
    if (current.provider === "openrouter") {
      const routePolicy = resolveMainRpOpenRouterRoutePolicy(candidate.modelId);
      if (!routePolicy) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_policy_missing",
        });
        continue;
      }
      const endpoint = currentOpenRouterEndpoint({ model });
      if (!endpoint) {
        skipped.push({
          modelId: candidate.modelId,
          reason: "current_openrouter_route_endpoint_missing",
        });
        continue;
      }
      currentProviderName = endpoint.providerName;
      currentProviderSlug = endpoint.providerSlug;
      currentServiceTier = endpoint.serviceTier;
    }

    const estimate = estimateCurrentPairUsd(inputPerM, outputPerM);
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
      currentProvider: current.provider,
      currentProviderName,
      currentProviderSlug,
      currentServiceTier,
      currentInputUsdPerMillion: inputPerM,
      currentOutputUsdPerMillion: outputPerM,
      estimatedPairCurrentRateUsd: estimate,
    });
    plannedModelIds.add(candidate.modelId);
    estimatedCurrentRateUsd += estimate;
  }

  if (entries.length * 2 > MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS) {
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
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_CURRENT_BASELINE_MAX_PROVIDER_CALLS,
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

export async function executeCheaperInferenceCurrentBaselineProbe(input: {
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
    turn.sawDone &&
    turn.servedProviderMatch !== false
  );
}

function currentOpenRouterProbeCandidate(
  entry: CurrentBaselinePlanEntry
): SupplyLiveCandidate {
  if (!entry.currentProviderSlug) {
    throw new Error("current_openrouter_provider_slug_missing");
  }
  return {
    ...entry.candidate,
    providerName: entry.currentProviderName,
    providerSlug: entry.currentProviderSlug,
    inputUsdPerMillion: entry.currentInputUsdPerMillion,
    outputUsdPerMillion: entry.currentOutputUsdPerMillion,
    estimatedPairRawEndpointRateUsd: entry.estimatedPairCurrentRateUsd,
    rawEndpointRateDeltaVsCurrentProcurementPercent: 0,
  };
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
      result = await executeOpenRouterSupplyProbe({
        apiKey: input.openRouterApiKey,
        candidate: currentOpenRouterProbeCandidate(input.entry),
        body: request.body,
        turn: (index + 1) as 1 | 2,
        fetchImpl: input.fetchImpl,
      });
    } else {
      const apiKey = input.cheaperInferenceApiKey?.trim();
      if (!apiKey) {
        throw new Error("missing_cheaper_inference_benchmark_credential");
      }
      result = await executeCheaperInferenceCurrentBaselineProbe({
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
      currentBaselineProvider: baseline.currentProvider,
      currentBaselineProviderName: baseline.currentProviderName,
      currentBaselineProviderSlug: baseline.currentProviderSlug,
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
      "This is a factual side-by-side transport/cache comparison, not an automatic provider selection.",
      "The candidate raw endpoint-rate estimate excludes OpenRouter account/platform fee interpretation.",
      "Current baseline follows the actual production procurement owner: CheaperInference models use the CI benchmark route; OpenRouter models use the canonical production provider pin and service tier.",
      "For same-OpenRouter comparisons, candidate and current baseline provider-reported costs share the same OpenRouter metadata semantics. Cross-provider cost fields remain evidence only and are not assumed directly equivalent.",
      "Two calls per side are not a statistical reliability sample. Market uptime metrics and the monthly cache/supply histories remain the stability owners."
      "Raw outputs remain review artifacts; no composite RP quality score is generated.",
    ],
  };
}

export function renderSupplyTransportComparisonMarkdown(
  report: SupplyTransportComparisonReport
): string {
  const lines = [
    "# Main RP Supply — Candidate vs Current Production Baseline",
    "",
    `- provider generation calls: **${report.providerGenerationCalls}/${report.maxProviderGenerationCalls}**`,
    `- candidate calls: ${report.candidateGenerationCalls}`,
    `- current baseline calls: ${report.currentBaselineGenerationCalls}`,
    "",
    "| Model | Candidate | Current baseline | Candidate TTFT avg | Baseline TTFT avg | Candidate total avg | Baseline total avg | Candidate cache T2 | Baseline cache T2 | Candidate raw pair est. | Baseline pair est. |",
    "|---|---|---|---:|---:|---:|---:|---|---|---:|---:|",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderName} | ${row.currentBaselineProviderName} (${row.currentBaselineProvider}) | ${row.candidateAverageTtftSeconds ?? "n/a"} | ${row.currentBaselineAverageTtftSeconds ?? "n/a"} | ${row.candidateAverageTotalSeconds ?? "n/a"} | ${row.currentBaselineAverageTotalSeconds ?? "n/a"} | ${row.candidateSecondTurnCacheReadObserved} | ${row.currentBaselineSecondTurnCacheReadObserved} | ${row.candidateEstimatedPairRawEndpointRateUsd.toFixed(4)} | ${row.currentBaselineEstimatedPairRateUsd.toFixed(4)} |`
    );
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
