import {
  buildCheaperInferenceChatCompletionsUrl,
  buildCheaperInferenceHeaders,
} from "@/lib/cheaperInferenceConfig";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
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
  processOpenRouterSupplySseLine,
  type SupplyLiveCandidate,
  type SupplyLiveCandidateResult,
  type SupplyLiveSelection,
  type SupplyLiveTurnResult,
} from "./mainRpSupplyLiveQualification";

export const MAIN_RP_SUPPLY_CI_BASELINE_VERSION = 1;
export const MAIN_RP_SUPPLY_CI_BASELINE_MAX_PROVIDER_CALLS = 10;
export const MAIN_RP_SUPPLY_CI_BASELINE_MAX_ESTIMATED_USD = 10;
export const MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS = 20;
export const MAIN_RP_SUPPLY_CI_BASELINE_TIMEOUT_MS = 90_000;

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

export type CurrentCiBaselinePlanEntry = {
  candidate: SupplyLiveCandidate;
  estimatedPairCatalogRateUsd: number;
};

export type CurrentCiBaselinePlan = {
  selection: SupplyLiveSelection;
  entries: CurrentCiBaselinePlanEntry[];
  skipped: Array<{
    modelId: string;
    reason:
      | "current_route_not_cheaperinference"
      | "current_ci_catalog_baseline_missing"
      | "current_ci_baseline_budget_guard";
  }>;
  estimatedCatalogRateUsd: number;
  maxProviderGenerationCalls: number;
};

export type CurrentCiBaselineResult = {
  modelId: SupplyLiveCandidate["modelId"];
  turns: SupplyLiveTurnResult[];
  providerGenerationCalls: number;
  livePairComplete: boolean;
  secondTurnCacheReadObserved: boolean;
  estimatedPairCatalogRateUsd: number;
};

export type SupplyTransportComparisonRow = {
  modelId: SupplyLiveCandidate["modelId"];
  candidateProviderName: string;
  candidateProviderSlug: string;
  candidatePairComplete: boolean;
  currentCiPairComplete: boolean;
  candidateSecondTurnCacheReadObserved: boolean;
  currentCiSecondTurnCacheReadObserved: boolean;
  candidateAverageTtftSeconds: number | null;
  currentCiAverageTtftSeconds: number | null;
  candidateAverageTotalSeconds: number | null;
  currentCiAverageTotalSeconds: number | null;
  candidateObservedProviderCostUsd: number | null;
  currentCiObservedBilledCostUsd: number | null;
  candidateEstimatedPairRawEndpointRateUsd: number;
  currentCiEstimatedPairCatalogRateUsd: number;
  marketRawEndpointRateDeltaVsCurrentCiPercent: number;
};

export type SupplyTransportComparisonReport = {
  version: number;
  generatedAt: string;
  providerGenerationCalls: number;
  maxProviderGenerationCalls: number;
  candidateGenerationCalls: number;
  currentCiGenerationCalls: number;
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

function estimateCiPairUsd(inputPerM: number, outputPerM: number): number {
  return 2 * (
    inputPerM * 50_000 / 1_000_000 +
    outputPerM * 1_200 / 1_000_000
  );
}

export function applyCurrentCiBaselineBudgetGuard(
  radar: MainRpSupplyRadarReport,
  selection: SupplyLiveSelection
): CurrentCiBaselinePlan {
  const entries: CurrentCiBaselinePlanEntry[] = [];
  const skipped: CurrentCiBaselinePlan["skipped"] = [];
  let estimatedCatalogRateUsd = 0;

  for (const candidate of selection.candidates) {
    const model = radar.models.find((row) => row.modelId === candidate.modelId);
    if (model?.currentProcurement?.provider !== "cheaperinference") {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_route_not_cheaperinference",
      });
      continue;
    }
    const inputPerM = asNumber(model.currentProcurement.inputUsdPerMillion);
    const outputPerM = asNumber(model?.currentProcurement?.outputUsdPerMillion);
    if (inputPerM == null || outputPerM == null) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_ci_catalog_baseline_missing",
      });
      continue;
    }

    const estimate = estimateCiPairUsd(inputPerM, outputPerM);
    if (
      estimatedCatalogRateUsd + estimate >
      MAIN_RP_SUPPLY_CI_BASELINE_MAX_ESTIMATED_USD
    ) {
      skipped.push({
        modelId: candidate.modelId,
        reason: "current_ci_baseline_budget_guard",
      });
      continue;
    }

    entries.push({ candidate, estimatedPairCatalogRateUsd: estimate });
    estimatedCatalogRateUsd += estimate;
  }

  if (entries.length * 2 > MAIN_RP_SUPPLY_CI_BASELINE_MAX_PROVIDER_CALLS) {
    throw new Error("Current CI baseline selection exceeded provider-call budget");
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
          providerName: "current-cheaperinference",
          reason: row.reason,
        })),
      ],
      estimatedRawEndpointRateUsd:
        Math.round(
          entries.reduce(
            (sum, entry) => sum + entry.candidate.estimatedPairRawEndpointRateUsd,
            0
          ) * 1_000_000
        ) / 1_000_000,
    },
    entries,
    skipped,
    estimatedCatalogRateUsd:
      Math.round(estimatedCatalogRateUsd * 1_000_000) / 1_000_000,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_CI_BASELINE_MAX_PROVIDER_CALLS,
  };
}

export function buildCurrentCiBaselineProbeRequest(input: {
  candidate: SupplyLiveCandidate;
  turn: CanonicalQualificationCase;
  sessionId: string;
}): { body: JsonObject; url: string } {
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: input.candidate.modelId,
    caseData: input.turn,
    provider: "cheaperinference",
  });
  contextInput.targetResponseChars = MAIN_RP_SUPPLY_LIVE_TARGET_CHARS;
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: input.candidate.modelId,
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

export async function executeCurrentCiBaselineProbe(input: {
  apiKey: string;
  candidate: SupplyLiveCandidate;
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
      signal: AbortSignal.timeout(MAIN_RP_SUPPLY_CI_BASELINE_TIMEOUT_MS),
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

export async function runCurrentCiBaselinePair(input: {
  apiKey: string;
  entry: CurrentCiBaselinePlanEntry;
  sessionId: string;
  fetchImpl?: FetchLike;
}): Promise<CurrentCiBaselineResult> {
  const turns = buildDeterministicSupplyProbeTurns();
  const results: SupplyLiveTurnResult[] = [];

  for (let index = 0; index < turns.length; index += 1) {
    const request = buildCurrentCiBaselineProbeRequest({
      candidate: input.entry.candidate,
      turn: turns[index]!,
      sessionId: input.sessionId,
    });
    const result = await executeCurrentCiBaselineProbe({
      apiKey: input.apiKey,
      candidate: input.entry.candidate,
      body: request.body,
      url: request.url,
      turn: (index + 1) as 1 | 2,
      fetchImpl: input.fetchImpl,
    });
    results.push(result);
    if (!isComplete(result)) break;
  }

  const livePairComplete =
    results.length === 2 && results.every((turn) => isComplete(turn));
  const secondTurn = results.find((turn) => turn.turn === 2) ?? null;
  return {
    modelId: input.entry.candidate.modelId,
    turns: results,
    providerGenerationCalls: results.length,
    livePairComplete,
    secondTurnCacheReadObserved: (secondTurn?.cacheReadTokens ?? 0) > 0,
    estimatedPairCatalogRateUsd: input.entry.estimatedPairCatalogRateUsd,
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
  currentCiResults: CurrentCiBaselineResult[];
  generatedAt?: string;
}): SupplyTransportComparisonReport {
  const rows: SupplyTransportComparisonRow[] = [];

  for (const candidateResult of input.candidateResults) {
    const baseline = input.currentCiResults.find(
      (row) => row.modelId === candidateResult.candidate.modelId
    );
    if (!baseline) continue;

    rows.push({
      modelId: candidateResult.candidate.modelId,
      candidateProviderName: candidateResult.candidate.providerName,
      candidateProviderSlug: candidateResult.candidate.providerSlug,
      candidatePairComplete: candidateResult.livePairComplete,
      currentCiPairComplete: baseline.livePairComplete,
      candidateSecondTurnCacheReadObserved:
        candidateResult.secondTurnCacheReadObserved,
      currentCiSecondTurnCacheReadObserved:
        baseline.secondTurnCacheReadObserved,
      candidateAverageTtftSeconds: average(
        candidateResult.turns.map((turn) => turn.ttftSeconds)
      ),
      currentCiAverageTtftSeconds: average(
        baseline.turns.map((turn) => turn.ttftSeconds)
      ),
      candidateAverageTotalSeconds: average(
        candidateResult.turns.map((turn) => turn.totalSeconds)
      ),
      currentCiAverageTotalSeconds: average(
        baseline.turns.map((turn) => turn.totalSeconds)
      ),
      candidateObservedProviderCostUsd: observedCost(candidateResult.turns),
      currentCiObservedBilledCostUsd: observedCost(baseline.turns),
      candidateEstimatedPairRawEndpointRateUsd:
        candidateResult.candidate.estimatedPairRawEndpointRateUsd,
      currentCiEstimatedPairCatalogRateUsd:
        baseline.estimatedPairCatalogRateUsd,
      marketRawEndpointRateDeltaVsCurrentCiPercent:
        candidateResult.candidate.rawEndpointRateDeltaVsCurrentProcurementPercent,
    });
  }

  const candidateCalls = input.candidateResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const currentCiCalls = input.currentCiResults.reduce(
    (sum, row) => sum + row.providerGenerationCalls,
    0
  );
  const totalCalls = candidateCalls + currentCiCalls;
  if (totalCalls > MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS) {
    throw new Error("Combined supply comparison exceeded provider-call budget");
  }

  return {
    version: MAIN_RP_SUPPLY_CI_BASELINE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    providerGenerationCalls: totalCalls,
    maxProviderGenerationCalls: MAIN_RP_SUPPLY_COMBINED_MAX_PROVIDER_CALLS,
    candidateGenerationCalls: candidateCalls,
    currentCiGenerationCalls: currentCiCalls,
    rows,
    notes: [
      "This is a factual side-by-side transport/cache comparison, not an automatic provider selection.",
      "The candidate raw endpoint-rate estimate excludes OpenRouter account/platform fee interpretation.",
      "Current CI observed cost is provider-reported billed evidence when present; candidate observed provider cost may represent upstream inference cost and is not assumed to be final cash procurement cost.",
      "Two calls per side are not a statistical reliability sample. Market uptime metrics and the monthly CI cache audit remain the stability/history owners.",
      "Raw outputs remain review artifacts; no composite RP quality score is generated.",
    ],
  };
}

export function renderSupplyTransportComparisonMarkdown(
  report: SupplyTransportComparisonReport
): string {
  const lines = [
    "# Main RP Supply — Candidate vs Current CI",
    "",
    `- provider generation calls: **${report.providerGenerationCalls}/${report.maxProviderGenerationCalls}**`,
    `- candidate calls: ${report.candidateGenerationCalls}`,
    `- current CI baseline calls: ${report.currentCiGenerationCalls}`,
    "",
    "| Model | Candidate | Candidate TTFT avg | CI TTFT avg | Candidate total avg | CI total avg | Candidate cache T2 | CI cache T2 | Candidate raw pair est. | CI catalog pair est. |",
    "|---|---|---:|---:|---:|---:|---|---|---:|---:|",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderName} | ${row.candidateAverageTtftSeconds ?? "n/a"} | ${row.currentCiAverageTtftSeconds ?? "n/a"} | ${row.candidateAverageTotalSeconds ?? "n/a"} | ${row.currentCiAverageTotalSeconds ?? "n/a"} | ${row.candidateSecondTurnCacheReadObserved} | ${row.currentCiSecondTurnCacheReadObserved} | $${row.candidateEstimatedPairRawEndpointRateUsd.toFixed(4)} | $${row.currentCiEstimatedPairCatalogRateUsd.toFixed(4)} |`
    );
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
