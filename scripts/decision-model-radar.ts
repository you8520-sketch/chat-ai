import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  DECISION_RADAR_BASELINE_MODEL,
  DECISION_RADAR_MAX_CANDIDATES_PER_RUN,
  evaluateDecisionCandidate,
  parseDecisionCatalog,
  parseDecisionRadarLedger,
  selectChangedDecisionCandidates,
  upsertDecisionRadarLedger,
  type DecisionBenchmarkSummary,
  type DecisionRadarRun,
} from "@/lib/decisionModelRadar";
import { runDecisionModelComparison } from "./lib/decisionModelComparison";
import { OPENROUTER_JEV_BENCHMARK_ENV } from "./lib/authorialHabitJevBenchmarkCredential";

const OUT_DIR =
  process.env.DECISION_MODEL_RADAR_OUT_DIR?.trim() ||
  "artifacts/decision-model-radar";
const LEDGER_PATH =
  process.env.DECISION_MODEL_RADAR_LEDGER_PATH?.trim() ||
  `${OUT_DIR}/ledger.json`;
const MODELS_URL =
  "https://openrouter.ai/api/v1/models?category=decisions&sort=newest";
const MAX_ESTIMATED_CANDIDATE_COST_USD = 0.02;
const ESTIMATED_INPUT_TOKENS_PER_CANDIDATE = 30_000;

function fmtPct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
function fmtUsd(value: number | null): string {
  return value == null ? "n/a" : `$${value.toFixed(6)}`;
}
function safeRunUrl(): string | null {
  const server = process.env.GITHUB_SERVER_URL?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  return server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null;
}

async function fetchDecisionCatalog(apiKey: string): Promise<unknown> {
  const response = await fetch(MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "chat-ai-decision-model-radar",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenRouter decision catalog HTTP ${response.status}`);
  }
  return response.json();
}

function renderReport(run: DecisionRadarRun): string {
  const lines = [
    "# Weekly Decision Model Radar",
    "",
    `- status: **${run.status}**`,
    `- discovered decision models: ${run.discoveredModels}`,
    `- changed/new candidates: ${run.changedCandidates.length}`,
    `- benchmarked: ${run.benchmarkedCandidates.length}`,
    `- deferred: ${run.deferredCandidates.length}`,
    `- provider calls: ${run.providerCalls}`,
    "- production model pin changed: **no**",
    "- auto-switch / auto-merge: **no**",
    "",
  ];

  if (run.baseline) {
    lines.push(
      "## Baseline",
      "",
      `- ${run.baseline.model}: accuracy ${fmtPct(run.baseline.accuracy)}, critical misses ${run.baseline.criticalMisses}, cost ${fmtUsd(run.baseline.reportedCostUsd)}, p50 ${run.baseline.latencyMs.p50 ?? "n/a"}ms`,
      ""
    );
  }

  if (run.evaluations.length) {
    lines.push("## Candidates", "");
    for (const row of run.evaluations) {
      lines.push(
        `### ${row.model}`,
        "",
        `- accuracy: ${fmtPct(row.summary.accuracy)}`,
        `- critical misses: ${row.summary.criticalMisses}`,
        `- malformed/failures: ${row.summary.malformed}/${row.summary.failures}`,
        `- cost: ${fmtUsd(row.summary.reportedCostUsd)}`,
        `- latency p50/p95: ${row.summary.latencyMs.p50 ?? "n/a"} / ${row.summary.latencyMs.p95 ?? "n/a"} ms`,
        `- global replacement gate: ${row.globalReplacementCandidate ? "REVIEW_CANDIDATE" : "NO"}`,
        `- suite candidates: ${row.suiteCandidates.length ? row.suiteCandidates.join(", ") : "none"}`,
        ""
      );
    }
  }

  if (run.deferredCandidates.length) {
    lines.push("## Deferred", "", ...run.deferredCandidates.map((model) => `- ${model}`), "");
  }
  if (run.notes.length) {
    lines.push("## Notes", "", ...run.notes.map((note) => `- ${note}`), "");
  }
  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const benchmarkKey = process.env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim();
  const liveEnabled =
    process.env.REGULAR_TEST_REAL_PROVIDER_CALLS === "1" &&
    process.env.DECISION_MODEL_RADAR_LIVE === "1";

  if (!benchmarkKey) throw new Error(`${OPENROUTER_JEV_BENCHMARK_ENV} is required`);

  const previousRaw = existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, "utf8") : null;
  const ledger = parseDecisionRadarLedger(previousRaw);
  const catalog = parseDecisionCatalog(await fetchDecisionCatalog(benchmarkKey));
  const selection = selectChangedDecisionCandidates({
    catalog,
    ledger,
    maxCandidates: DECISION_RADAR_MAX_CANDIDATES_PER_RUN,
  });

  const notes: string[] = [];
  const affordable = selection.selected.filter((model) => {
    if (model.promptUsdPerMillion == null) {
      notes.push(`${model.id}: pricing unavailable; deferred`);
      return false;
    }
    const estimated =
      (model.promptUsdPerMillion * ESTIMATED_INPUT_TOKENS_PER_CANDIDATE) / 1_000_000;
    if (estimated > MAX_ESTIMATED_CANDIDATE_COST_USD) {
      notes.push(
        `${model.id}: estimated candidate cost $${estimated.toFixed(4)} exceeds $${MAX_ESTIMATED_CANDIDATE_COST_USD.toFixed(2)} cap`
      );
      return false;
    }
    return true;
  });
  const costDeferred = selection.selected
    .filter((model) => !affordable.includes(model))
    .map((model) => model.id);
  const deferredCandidates = [
    ...selection.deferred.map((model) => model.id),
    ...costDeferred,
  ];

  let baseline: DecisionBenchmarkSummary | null = null;
  const evaluations = [];
  let providerCalls = 0;

  if (affordable.length > 0) {
    if (!liveEnabled) {
      notes.push("live benchmark gate disabled; candidates discovered but not called");
    } else {
      const models = [
        DECISION_RADAR_BASELINE_MODEL,
        ...affordable.map((model) => model.id),
      ];
      const comparison = await runDecisionModelComparison({
        models,
        benchmarkKey,
      });
      providerCalls = comparison.rows.length;
      baseline =
        (comparison.summary.find(
          (row) => row.model === DECISION_RADAR_BASELINE_MODEL
        ) as DecisionBenchmarkSummary | undefined) ?? null;
      if (!baseline) throw new Error("baseline comparison summary missing");

      for (const candidate of affordable) {
        const summary = comparison.summary.find(
          (row) => row.model === candidate.id
        ) as DecisionBenchmarkSummary | undefined;
        if (!summary) {
          notes.push(`${candidate.id}: benchmark summary missing`);
          continue;
        }
        evaluations.push(
          evaluateDecisionCandidate(baseline, summary, candidate.fingerprint)
        );
      }
    }
  }

  const anyReview = evaluations.some(
    (row) => row.globalReplacementCandidate || row.suiteCandidates.length > 0
  );
  const anyFailure = evaluations.some(
    (row) => row.summary.failures > 0 || row.summary.malformed > 0
  );
  const status: DecisionRadarRun["status"] =
    selection.changed.length === 0
      ? "NO_CHANGE"
      : !liveEnabled || affordable.length === 0
        ? "PARTIAL"
        : anyFailure
          ? "PARTIAL"
          : anyReview
            ? "REVIEW_CANDIDATE"
            : "BENCHMARKED";

  const run: DecisionRadarRun = {
    ranAt: new Date().toISOString(),
    mainSha:
      process.env.DECISION_MODEL_RADAR_MAIN_SHA?.trim() ||
      process.env.GITHUB_SHA?.trim() ||
      "unknown",
    status,
    discoveredModels: catalog.length,
    changedCandidates: selection.changed.map((model) => model.id),
    benchmarkedCandidates: evaluations.map((row) => row.model),
    deferredCandidates,
    providerCalls,
    baseline,
    evaluations,
    notes,
    githubRunUrl: safeRunUrl(),
  };

  const nextLedger = upsertDecisionRadarLedger({ ledger, catalog, run });
  const latestPath = `${OUT_DIR}/latest.json`;
  const ledgerOut = `${OUT_DIR}/ledger.json`;
  writeFileSync(latestPath, JSON.stringify(run, null, 2));
  writeFileSync(ledgerOut, JSON.stringify(nextLedger, null, 2));
  writeFileSync(`${OUT_DIR}/REPORT.md`, renderReport(run));

  console.log(
    JSON.stringify(
      {
        status: run.status,
        discoveredModels: run.discoveredModels,
        changedCandidates: run.changedCandidates,
        benchmarkedCandidates: run.benchmarkedCandidates,
        deferredCandidates: run.deferredCandidates,
        providerCalls: run.providerCalls,
        reviewCandidates: evaluations
          .filter(
            (row) =>
              row.globalReplacementCandidate || row.suiteCandidates.length > 0
          )
          .map((row) => ({
            model: row.model,
            global: row.globalReplacementCandidate,
            suites: row.suiteCandidates,
          })),
        productionMutationEnabled: false,
        runtimeModelPinChanged: false,
        autoSwitchEnabled: false,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
