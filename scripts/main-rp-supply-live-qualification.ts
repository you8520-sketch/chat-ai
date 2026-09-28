import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  applyCurrentCiBaselineBudgetGuard,
  buildSupplyTransportComparisonReport,
  renderSupplyTransportComparisonMarkdown,
  runCurrentCiBaselinePair,
  type CurrentCiBaselineResult,
} from "./lib/mainRpSupplyCiBaseline";
import type { MainRpSupplyRadarReport } from "./lib/mainRpSupplyRadar";
import {
  buildSupplyLiveReport,
  renderSupplyLiveReportMarkdown,
  runOpenRouterSupplyCandidatePair,
  selectMainRpSupplyLiveCandidates,
  type SupplyLiveCandidateResult,
} from "./lib/mainRpSupplyLiveQualification";
import {
  resolveOptInOpenRouterSupplyBenchmarkApiKey,
  sanitizeSupplyBenchmarkCredentialText,
} from "./lib/mainRpSupplyLiveQualificationCredential";

const RADAR_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const RADAR_REPORT =
  process.env.MAIN_RP_SUPPLY_RADAR_REPORT?.trim() ||
  join(RADAR_DIR, "report.json");
const LIVE_DIR =
  process.env.MAIN_RP_SUPPLY_LIVE_OUTPUT_DIR?.trim() ||
  join(RADAR_DIR, "live");
const LIVE_FLAG = "MAIN_RP_SUPPLY_LIVE_QUALIFICATION";

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function sanitizeError(value: unknown): string {
  const raw =
    value instanceof Error ? value.stack ?? value.message : String(value);
  return sanitizeBenchmarkCredentialText(
    sanitizeSupplyBenchmarkCredentialText(raw)
  );
}

function writeTurnArtifacts(
  dir: string,
  turns: Array<{
    turn: 1 | 2;
    text: string;
  }>
): void {
  mkdirSync(dir, { recursive: true });
  for (const turn of turns) {
    writeFileSync(join(dir, `turn-${turn.turn}.txt`), turn.text, "utf8");
    const { text: _text, ...meta } = turn;
    writeFileSync(
      join(dir, `turn-${turn.turn}-meta.json`),
      JSON.stringify(meta, null, 2),
      "utf8"
    );
  }
}

function writeArtifacts(input: {
  report: ReturnType<typeof buildSupplyLiveReport>;
  comparison: ReturnType<typeof buildSupplyTransportComparisonReport>;
  currentCiResults: CurrentCiBaselineResult[];
  errors: string[];
}): void {
  mkdirSync(LIVE_DIR, { recursive: true });
  writeFileSync(
    join(LIVE_DIR, "live-qualification.json"),
    JSON.stringify({ ...input.report, errors: input.errors }, null, 2),
    "utf8"
  );
  writeFileSync(
    join(LIVE_DIR, "LIVE-QUALIFICATION.md"),
    renderSupplyLiveReportMarkdown(input.report) +
      (input.errors.length
        ? "\n## Runner notes\n\n" +
          input.errors.map((error) => `- ${error}`).join("\n") +
          "\n"
        : ""),
    "utf8"
  );
  writeFileSync(
    join(LIVE_DIR, "comparison.json"),
    JSON.stringify(input.comparison, null, 2),
    "utf8"
  );
  writeFileSync(
    join(LIVE_DIR, "COMPARISON.md"),
    renderSupplyTransportComparisonMarkdown(input.comparison),
    "utf8"
  );

  for (const result of input.report.results) {
    writeTurnArtifacts(
      join(
        LIVE_DIR,
        "candidate",
        safePart(result.candidate.modelId),
        safePart(result.candidate.providerSlug)
      ),
      result.turns
    );
  }

  for (const result of input.currentCiResults) {
    writeTurnArtifacts(
      join(LIVE_DIR, "current-ci", safePart(result.modelId)),
      result.turns
    );
  }
}

async function main(): Promise<void> {
  const radar = JSON.parse(
    readFileSync(RADAR_REPORT, "utf8")
  ) as MainRpSupplyRadarReport;
  const initialSelection = selectMainRpSupplyLiveCandidates(radar);
  const baselinePlan = applyCurrentCiBaselineBudgetGuard(
    radar,
    initialSelection
  );
  const selection = baselinePlan.selection;
  const openRouterCredential = resolveOptInOpenRouterSupplyBenchmarkApiKey();
  const ciCredential = resolveOptInTestCheaperInferenceApiKey(LIVE_FLAG);
  const errors: string[] = [];

  const missingReason = !openRouterCredential.ok
    ? openRouterCredential.reason
    : !ciCredential
      ? "missing_cheaper_inference_benchmark_credential"
      : null;

  if (missingReason) {
    const report = buildSupplyLiveReport({
      selection,
      results: [],
      notRunReason: missingReason,
    });
    const comparison = buildSupplyTransportComparisonReport({
      candidateResults: [],
      currentCiResults: [],
    });
    writeArtifacts({
      report,
      comparison,
      currentCiResults: [],
      errors,
    });
    console.log(
      JSON.stringify(
        {
          status: report.status,
          provider_generation_calls: 0,
          selected_candidates: selection.candidates.length,
          reason: missingReason,
          current_ci_estimated_catalog_rate_usd:
            baselinePlan.estimatedCatalogRateUsd,
        },
        null,
        2
      )
    );
    return;
  }

  const candidateResults: SupplyLiveCandidateResult[] = [];
  const currentCiResults: CurrentCiBaselineResult[] = [];
  const runId =
    process.env.GITHUB_RUN_ID?.trim() ||
    `manual-${new Date().toISOString().slice(0, 16)}`;

  for (const entry of baselinePlan.entries) {
    const candidate = entry.candidate;
    try {
      const ciSessionId = [
        "supply-ci",
        runId,
        safePart(candidate.modelId),
      ]
        .join("-")
        .slice(0, 256);
      currentCiResults.push(
        await runCurrentCiBaselinePair({
          apiKey: ciCredential,
          entry,
          sessionId: ciSessionId,
        })
      );
    } catch (error) {
      errors.push(
        `${candidate.modelId}/current-ci: ${sanitizeError(error)}`
      );
    }

    try {
      const candidateSessionId = [
        "supply-live",
        runId,
        safePart(candidate.modelId),
        safePart(candidate.providerSlug),
      ]
        .join("-")
        .slice(0, 256);
      candidateResults.push(
        await runOpenRouterSupplyCandidatePair({
          apiKey: openRouterCredential.apiKey,
          candidate,
          sessionId: candidateSessionId,
        })
      );
    } catch (error) {
      errors.push(
        `${candidate.modelId}/${candidate.providerName}: ${sanitizeError(
          error
        )}`
      );
    }
  }

  const report = buildSupplyLiveReport({
    selection,
    results: candidateResults,
  });
  const comparison = buildSupplyTransportComparisonReport({
    candidateResults,
    currentCiResults,
  });
  writeArtifacts({
    report,
    comparison,
    currentCiResults,
    errors,
  });

  console.log(
    JSON.stringify(
      {
        status: report.status,
        candidate_provider_generation_calls:
          report.providerGenerationCalls,
        current_ci_provider_generation_calls:
          comparison.currentCiGenerationCalls,
        total_provider_generation_calls:
          comparison.providerGenerationCalls,
        max_total_provider_generation_calls:
          comparison.maxProviderGenerationCalls,
        selected_candidates: selection.candidates.length,
        completed_candidate_pairs: candidateResults.filter(
          (result) => result.livePairComplete
        ).length,
        completed_current_ci_pairs: currentCiResults.filter(
          (result) => result.livePairComplete
        ).length,
        candidate_second_turn_cache_hits: candidateResults.filter(
          (result) => result.secondTurnCacheReadObserved
        ).length,
        current_ci_second_turn_cache_hits: currentCiResults.filter(
          (result) => result.secondTurnCacheReadObserved
        ).length,
        estimated_candidate_raw_endpoint_rate_usd:
          selection.estimatedRawEndpointRateUsd,
        estimated_current_ci_catalog_rate_usd:
          baselinePlan.estimatedCatalogRateUsd,
        errors,
        output_dir: LIVE_DIR,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(sanitizeError(error));
  console.log("provider_generation_calls=0");
  process.exitCode = 1;
});
