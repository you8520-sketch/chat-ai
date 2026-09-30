import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  applyCurrentBaselineBudgetGuard,
  buildSupplyTransportComparisonReport,
  renderSupplyTransportComparisonMarkdown,
  runCurrentBaselinePair,
  type CurrentBaselineResult,
} from "./lib/mainRpSupplyCurrentBaseline";
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
  currentBaselineResults: CurrentBaselineResult[];
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

  for (const result of input.currentBaselineResults) {
    writeTurnArtifacts(
      join(
        LIVE_DIR,
        "current-baseline",
        result.currentProvider,
        safePart(result.modelId)
      ),
      result.turns
    );
  }
}

async function main(): Promise<void> {
  const radar = JSON.parse(
    readFileSync(RADAR_REPORT, "utf8")
  ) as MainRpSupplyRadarReport;
  const initialSelection = selectMainRpSupplyLiveCandidates(radar);
  const baselinePlan = applyCurrentBaselineBudgetGuard(
    radar,
    initialSelection
  );
  const openRouterCredential = resolveOptInOpenRouterSupplyBenchmarkApiKey();
  const ciCredential = resolveOptInTestCheaperInferenceApiKey(LIVE_FLAG);
  const errors: string[] = [];

  const missingCiModels = new Set(
    !ciCredential
      ? baselinePlan.entries
          .filter((entry) => entry.currentProvider === "cheaperinference")
          .map((entry) => entry.candidate.modelId)
      : []
  );
  const runnableEntries = baselinePlan.entries.filter(
    (entry) => !missingCiModels.has(entry.candidate.modelId)
  );
  const selection = {
    ...baselinePlan.selection,
    candidates: baselinePlan.selection.candidates.filter(
      (candidate) => !missingCiModels.has(candidate.modelId)
    ),
    skipped: [
      ...baselinePlan.selection.skipped,
      ...[...missingCiModels].map((modelId) => ({
        modelId,
        providerName: "current-production-route",
        reason: "missing_cheaper_inference_benchmark_credential",
      })),
    ],
  };

  const missingReason = !openRouterCredential.ok
    ? openRouterCredential.reason
    : runnableEntries.length === 0 && baselinePlan.entries.length > 0
      ? "no_current_baseline_credential_available"
      : null;

  if (missingReason) {
    const report = buildSupplyLiveReport({
      selection,
      results: [],
      notRunReason: missingReason,
    });
    const comparison = buildSupplyTransportComparisonReport({
      candidateResults: [],
      currentBaselineResults: [],
    });
    writeArtifacts({
      report,
      comparison,
      currentBaselineResults: [],
      errors,
    });
    console.log(
      JSON.stringify(
        {
          status: report.status,
          provider_generation_calls: 0,
          selected_candidates: selection.candidates.length,
          reason: missingReason,
          current_baseline_estimated_rate_usd:
            baselinePlan.estimatedCurrentRateUsd,
        },
        null,
        2
      )
    );
    return;
  }

  const candidateResults: SupplyLiveCandidateResult[] = [];
  const currentBaselineResults: CurrentBaselineResult[] = [];
  const runId =
    process.env.GITHUB_RUN_ID?.trim() ||
    `manual-${new Date().toISOString().slice(0, 16)}`;

  for (const entry of runnableEntries) {
    const baselineCandidate = entry.candidate;
    try {
      const baselineSessionId = [
        "supply-baseline",
        runId,
        safePart(baselineCandidate.modelId),
      ]
        .join("-")
        .slice(0, 256);
      currentBaselineResults.push(
        await runCurrentBaselinePair({
          openRouterApiKey: openRouterCredential.apiKey,
          cheaperInferenceApiKey: ciCredential,
          entry,
          sessionId: baselineSessionId,
        })
      );
    } catch (error) {
      errors.push(
        `${baselineCandidate.modelId}/current-baseline: ${sanitizeError(error)}`
      );
    }

    const modelCandidates = selection.candidates.filter(
      (candidate) => candidate.modelId === baselineCandidate.modelId
    );
    for (const candidate of modelCandidates) {
      try {
        const candidateSessionId = [
          "supply-live",
          runId,
          safePart(candidate.modelId),
          safePart(candidate.providerSlug),
        ]
          .join("-")
          .slice(0, 256);
        const result = await runOpenRouterSupplyCandidatePair({
          apiKey: openRouterCredential.apiKey,
          candidate,
          sessionId: candidateSessionId,
        });
        candidateResults.push(result);
        // Alternatives are ordered by price after factual preflight. Stop
        // spending once this model has one complete two-turn transport proof.
        if (result.livePairComplete) break;
      } catch (error) {
        errors.push(
          `${candidate.modelId}/${candidate.providerName}: ${sanitizeError(
            error
          )}`
        );
      }
    }
  }

  const report = buildSupplyLiveReport({
    selection,
    results: candidateResults,
  });
  const comparison = buildSupplyTransportComparisonReport({
    candidateResults,
    currentBaselineResults,
  });
  writeArtifacts({
    report,
    comparison,
    currentBaselineResults,
    errors,
  });

  console.log(
    JSON.stringify(
      {
        status: report.status,
        candidate_provider_generation_calls:
          report.providerGenerationCalls,
        current_baseline_provider_generation_calls:
          comparison.currentBaselineGenerationCalls,
        total_provider_generation_calls:
          comparison.providerGenerationCalls,
        max_total_provider_generation_calls:
          comparison.maxProviderGenerationCalls,
        selected_candidates: selection.candidates.length,
        completed_candidate_pairs: candidateResults.filter(
          (result) => result.livePairComplete
        ).length,
        completed_current_baseline_pairs: currentBaselineResults.filter(
          (result) => result.livePairComplete
        ).length,
        candidate_second_turn_cache_hits: candidateResults.filter(
          (result) => result.secondTurnCacheReadObserved
        ).length,
        current_baseline_second_turn_cache_hits: currentBaselineResults.filter(
          (result) => result.secondTurnCacheReadObserved
        ).length,
        estimated_candidate_raw_endpoint_rate_usd:
          selection.estimatedRawEndpointRateUsd,
        estimated_current_baseline_rate_usd:
          baselinePlan.estimatedCurrentRateUsd,
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
