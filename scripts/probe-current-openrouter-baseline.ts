import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyCurrentBaselineBudgetGuard,
  runCurrentBaselinePair,
} from "./lib/mainRpSupplyCurrentBaseline";
import {
  selectCurrentOpenRouterRouteEndpoint,
  type MainRpSupplyRadarReport,
} from "./lib/mainRpSupplyRadar";
import type {
  SupplyLiveCandidate,
  SupplyLiveSelection,
} from "./lib/mainRpSupplyLiveQualification";
import { resolveOptInOpenRouterSupplyBenchmarkApiKey } from "./lib/mainRpSupplyLiveQualificationCredential";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const REPORT_PATH = join(OUT_DIR, "report.json");
const OUTPUT_PATH = join(OUT_DIR, "current-openrouter-baseline-smoke.json");
const MODEL_ID = "gemini-3.7-flash" as const;

function pairEstimate(inputPerM: number, outputPerM: number): number {
  return (
    2 *
    (inputPerM * 50_000 / 1_000_000 +
      outputPerM * 1_200 / 1_000_000)
  );
}

async function main(): Promise<void> {
  const radar = JSON.parse(
    readFileSync(REPORT_PATH, "utf8")
  ) as MainRpSupplyRadarReport;
  const model = radar.models.find((row) => row.modelId === MODEL_ID);
  if (!model) throw new Error("smoke_model_missing");
  if (model.currentProcurement?.provider !== "openrouter") {
    throw new Error(
      `unexpected_current_provider:${model.currentProcurement?.provider ?? "none"}`
    );
  }
  const endpoint = selectCurrentOpenRouterRouteEndpoint(
    MODEL_ID,
    model.comparisons
  );
  if (!endpoint?.provider?.slug) {
    throw new Error("current_openrouter_endpoint_missing");
  }
  const inputPerM = endpoint.inputUsdPerMillion;
  const outputPerM = endpoint.outputUsdPerMillion;
  if (inputPerM == null || outputPerM == null) {
    throw new Error("current_openrouter_rate_missing");
  }

  const candidate: SupplyLiveCandidate = {
    modelId: MODEL_ID,
    openRouterSlug: model.openRouterSlug,
    providerName: endpoint.providerName,
    providerSlug: endpoint.provider.slug,
    quantization: endpoint.quantization,
    rawEndpointRateDeltaVsCurrentProcurementPercent: 0,
    inputUsdPerMillion: inputPerM,
    outputUsdPerMillion: outputPerM,
    cacheReadUsdPerMillion: endpoint.cacheReadUsdPerMillion,
    marketLatencyP50SecondsLast30m:
      endpoint.latencyP50SecondsLast30m ?? 0,
    marketThroughputP50TokensPerSecondLast30m:
      endpoint.throughputP50TokensPerSecondLast30m ?? 0,
    marketUptimeLast1dPercent: endpoint.uptimeLast1dPercent ?? 0,
    marketUptimeLast30mPercent: endpoint.uptimeLast30mPercent ?? 0,
    controlEffort: "none",
    excludeReasoning: true,
    estimatedPairRawEndpointRateUsd: pairEstimate(inputPerM, outputPerM),
  };
  const selection: SupplyLiveSelection = {
    candidates: [candidate],
    skipped: [],
    maxProviderGenerationCalls: 2,
    estimatedRawEndpointRateUsd: candidate.estimatedPairRawEndpointRateUsd,
  };
  const plan = applyCurrentBaselineBudgetGuard(radar, selection);
  const entry = plan.entries[0];
  if (!entry) throw new Error("current_baseline_plan_entry_missing");
  if (entry.currentProvider !== "openrouter") {
    throw new Error(`unexpected_baseline_provider:${entry.currentProvider}`);
  }
  if (entry.currentProviderSlug !== "google-ai-studio") {
    throw new Error(
      `unexpected_provider_slug:${entry.currentProviderSlug ?? "none"}`
    );
  }
  if (entry.currentServiceTier !== "flex") {
    throw new Error(
      `unexpected_service_tier:${entry.currentServiceTier ?? "default"}`
    );
  }

  const credential = resolveOptInOpenRouterSupplyBenchmarkApiKey();
  if (!credential.ok) throw new Error(credential.reason);

  const result = await runCurrentBaselinePair({
    openRouterApiKey: credential.apiKey,
    entry,
    sessionId: `current-openrouter-baseline-${process.env.GITHUB_RUN_ID ?? "manual"}`,
  });

  const output = {
    modelId: result.modelId,
    currentProvider: result.currentProvider,
    currentProviderName: result.currentProviderName,
    currentProviderSlug: result.currentProviderSlug,
    currentServiceTier: result.currentServiceTier,
    providerGenerationCalls: result.providerGenerationCalls,
    livePairComplete: result.livePairComplete,
    secondTurnCacheReadObserved: result.secondTurnCacheReadObserved,
    turns: result.turns.map((turn) => ({
      turn: turn.turn,
      httpStatus: turn.httpStatus,
      finishReason: turn.finishReason,
      sawDone: turn.sawDone,
      ttftSeconds: turn.ttftSeconds,
      totalSeconds: turn.totalSeconds,
      visibleChars: turn.visibleChars,
      cacheReadTokens: turn.cacheReadTokens,
      servedProviderMatch: turn.servedProviderMatch,
      error: turn.error,
    })),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify(output, null, 2));

  if (!result.livePairComplete) {
    throw new Error("current_openrouter_baseline_pair_incomplete");
  }
  if (result.providerGenerationCalls !== 2) {
    throw new Error(
      `unexpected_provider_generation_calls:${result.providerGenerationCalls}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
