/**
 * Analyze raw reliability benchmark JSONL and emit comparison artifacts.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BenchRecord, ReliabilityClassification } from "./run-bench";
import {
  PRODUCTION_LUNA_MODEL_ID,
  RELIABILITY_BENCH_MODELS,
} from "./models";

const OUT_DIR = join(process.cwd(), "docs/audits/3-model-summary-reliability-speed-60");
const RAW_PATH = join(OUT_DIR, "raw-results.jsonl");

function loadResults(): BenchRecord[] {
  return readFileSync(RAW_PATH, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BenchRecord);
}

function num(v: number | "NOT_AVAILABLE"): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = mean(nums)!;
  const v = nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function median(sorted: number[]): number | null {
  return percentile(sorted, 50);
}

type ModelStats = {
  label: string;
  requestedModelId: string;
  totalCalls: number;
  validSuccess: number;
  hardFailure: number;
  emptyResponse: number;
  timeout: number;
  httpError: number;
  providerError: number;
  malformed: number;
  lengthTruncated: number;
  validSuccessRate: number;
  hardFailureRate: number;
  emptyResponseRate: number;
  timeoutRate: number;
  lengthTruncationRate: number;
  latencyAll: ReturnType<typeof latencyBlock>;
  latencySuccess: ReturnType<typeof latencyBlock>;
  latencyFailure: ReturnType<typeof latencyBlock>;
  costTotal: number | null;
  costAvg: number | null;
  costMedian: number | null;
  costPerValidSuccess: number | null;
};

function latencyBlock(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    mean: mean(sorted),
    median: median(sorted),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    p99_note: "P99_DIRECTIONAL_ONLY",
    min: sorted.length ? sorted[0]! : null,
    max: sorted.length ? sorted[sorted.length - 1]! : null,
    stdev: stdev(sorted),
  };
}

function computeModelStats(label: string, rows: BenchRecord[]): ModelStats {
  const requestedModelId =
    RELIABILITY_BENCH_MODELS.find((m) => m.label === label)?.requestedModelId ?? "";
  const totalCalls = rows.length;
  const validSuccess = rows.filter((r) => r.classification === "VALID_SUCCESS").length;
  const emptyResponse = rows.filter((r) => r.classification === "EMPTY_RESPONSE").length;
  const timeout = rows.filter((r) => r.classification === "TIMEOUT").length;
  const httpError = rows.filter((r) => r.classification === "HTTP_ERROR").length;
  const providerError = rows.filter((r) => r.classification === "PROVIDER_ERROR").length;
  const malformed = rows.filter((r) => r.classification === "MALFORMED_RESPONSE").length;
  const lengthTruncated = rows.filter((r) => r.length_truncated).length;
  const hardFailure = totalCalls - validSuccess;

  const costs = rows
    .map((r) => num(r.reported_cost_usd))
    .filter((v): v is number => v != null);
  const costTotal = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  const costSorted = [...costs].sort((a, b) => a - b);

  const allLat = rows.map((r) => r.total_latency_ms);
  const successLat = rows
    .filter((r) => r.classification === "VALID_SUCCESS")
    .map((r) => r.total_latency_ms);
  const failureLat = rows
    .filter((r) => r.classification !== "VALID_SUCCESS")
    .map((r) => r.total_latency_ms);

  return {
    label,
    requestedModelId,
    totalCalls,
    validSuccess,
    hardFailure,
    emptyResponse,
    timeout,
    httpError,
    providerError,
    malformed,
    lengthTruncated,
    validSuccessRate: totalCalls ? validSuccess / totalCalls : 0,
    hardFailureRate: totalCalls ? hardFailure / totalCalls : 0,
    emptyResponseRate: totalCalls ? emptyResponse / totalCalls : 0,
    timeoutRate: totalCalls ? timeout / totalCalls : 0,
    lengthTruncationRate: totalCalls ? lengthTruncated / totalCalls : 0,
    latencyAll: latencyBlock(allLat),
    latencySuccess: latencyBlock(successLat),
    latencyFailure: latencyBlock(failureLat),
    costTotal,
    costAvg: costs.length ? costTotal! / costs.length : null,
    costMedian: median(costSorted),
    costPerValidSuccess:
      validSuccess > 0 && costTotal != null ? costTotal / validSuccess : null,
  };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}`;
}

function fmtUsd(n: number | null): string {
  return n == null ? "—" : n.toFixed(6);
}

function providerTable(rows: BenchRecord[]): string {
  const byKey = new Map<string, BenchRecord[]>();
  for (const r of rows) {
    const key = `${r.model_label}::${r.provider}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const lines = [
    "| Model | Provider | Calls | Valid | Failures | Median latency (ms) |",
    "| ----- | -------- | ----: | ----: | -------: | ------------------: |",
  ];
  for (const [key, group] of [...byKey.entries()].sort()) {
    const [model, provider] = key.split("::");
    const valid = group.filter((r) => r.classification === "VALID_SUCCESS").length;
    const fail = group.length - valid;
    const lats = group.map((r) => r.total_latency_ms).sort((a, b) => a - b);
    lines.push(
      `| ${model} | ${provider} | ${group.length} | ${valid} | ${fail} | ${fmtMs(median(lats))} |`
    );
  }
  return lines.join("\n");
}

function notableFailures(rows: BenchRecord[]): string[] {
  const notes: string[] = [];
  for (const m of RELIABILITY_BENCH_MODELS) {
    const sub = rows.filter((r) => r.model_label === m.label);
    const stats = computeModelStats(m.label, sub);
    if (stats.hardFailureRate >= 0.05) {
      notes.push(
        `${m.label}: hard failure rate ${fmtPct(stats.hardFailureRate)} (≥5% screening threshold)`
      );
    }
    if (stats.emptyResponseRate > 0) {
      notes.push(`${m.label}: EMPTY_RESPONSE rate ${fmtPct(stats.emptyResponseRate)}`);
    }
  }
  const empty0731Like = rows.filter(
    (r) =>
      r.classification === "EMPTY_RESPONSE" &&
      r.http_status === 200 &&
      r.finish_reason === "length"
  );
  if (empty0731Like.length) {
    notes.push(
      `${empty0731Like.length} calls: HTTP 200 + finish_reason=length + empty visible content (0731-quality pattern on other models)`
    );
  }
  return notes;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = loadResults();
  const invariants = JSON.parse(
    readFileSync(join(OUT_DIR, "run-invariants.json"), "utf8")
  ) as Record<string, unknown>;

  const modelStats = RELIABILITY_BENCH_MODELS.map((m) =>
    computeModelStats(m.label, rows.filter((r) => r.model_label === m.label))
  );

  const metadata = {
    benchmark: "3-model-summary-reliability-speed-60",
    purpose: "reliability_speed_cost_screening",
    cursor_final_model_ranking: "NOT_PERFORMED",
    gpt_quality_scores_reference: {
      "Gemini 3.1 Flash-Lite": 91.0,
      "DeepSeek V4 Flash": 84.5,
      GLM: 82.5,
      "DeepSeek V4 Flash-0731": "excluded",
    },
    production_luna_model_id: PRODUCTION_LUNA_MODEL_ID,
    invariants,
    model_stats: modelStats,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, "run-metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  const comparisonLines = [
    "# 3-Model Summary Reliability / Speed / Cost (60 calls each)",
    "",
    "PURPOSE: Reliability/speed/cost screening — **not** quality rescoring.",
    "CURSOR_FINAL_MODEL_RANKING: NOT PERFORMED",
    "",
    "GPT quality reference (not recomputed): Gemini 91.0, DeepSeek V4 84.5, GLM 82.5, 0731 excluded.",
    "",
    "## Summary table",
    "",
    "| Model | Valid | Hard fail | Empty | Timeout | Length | P50 (ms) | P90 (ms) | P95 (ms) | Avg cost | Cost / valid |",
    "| ----- | ----: | --------: | ----: | ------: | -----: | -------: | -------: | -------: | -------: | -----------: |",
  ];

  for (const s of modelStats) {
    comparisonLines.push(
      `| ${s.label} | ${s.validSuccess}/60 (${fmtPct(s.validSuccessRate)}) | ${s.hardFailure} (${fmtPct(s.hardFailureRate)}) | ${s.emptyResponse} (${fmtPct(s.emptyResponseRate)}) | ${s.timeout} (${fmtPct(s.timeoutRate)}) | ${s.lengthTruncated} (${fmtPct(s.lengthTruncationRate)}) | ${fmtMs(s.latencyAll.p50)} | ${fmtMs(s.latencyAll.p90)} | ${fmtMs(s.latencyAll.p95)} | ${fmtUsd(s.costAvg)} | ${fmtUsd(s.costPerValidSuccess)} |`
    );
  }

  comparisonLines.push("", "## Provider distribution", "", providerTable(rows));
  comparisonLines.push("", "## Latency notes", "", "- P99 values are **P99_DIRECTIONAL_ONLY** (n=60).", "- Prefer P50 / P90 / P95 for decisions.", "");
  comparisonLines.push("## Success vs failure latency (ms)", "");
  for (const s of modelStats) {
    comparisonLines.push(`### ${s.label}`);
    comparisonLines.push(
      `- SUCCESS: mean ${fmtMs(s.latencySuccess.mean)}, P50 ${fmtMs(s.latencySuccess.p50)}, P90 ${fmtMs(s.latencySuccess.p90)}`
    );
    comparisonLines.push(
      `- FAILURE: mean ${fmtMs(s.latencyFailure.mean)}, P50 ${fmtMs(s.latencyFailure.p50)}, P90 ${fmtMs(s.latencyFailure.p90)}`
    );
    comparisonLines.push("");
  }

  writeFileSync(
    join(OUT_DIR, "RELIABILITY_SPEED_COMPARISON.md"),
    comparisonLines.join("\n"),
    "utf8"
  );

  const runReport = `# RUN_REPORT — 3-Model Summary Reliability / Speed (60 calls each)

## Status

BENCHMARK: 3-model reliability/speed/cost screening
PURPOSE: Compare TOP2 quality candidates + production Luna baseline
CURSOR_FINAL_MODEL_RANKING: NOT PERFORMED
PRODUCTION_CHANGED: false

## Current main audit (background summary)

| Item | Value |
| ---- | ----- |
| Production Luna model ID | \`${PRODUCTION_LUNA_MODEL_ID}\` (\`CHEAPER_INFERENCE_GPT_56_LUNA_MODEL\`, default when \`BACKGROUND_MEMORY_MODEL\` unset) |
| Transport | CheaperInference \`https://api.cheaperinference.com/v1/chat/completions\` for Luna/Gemini/DeepSeek CI models |
| Production timeout | 120_000 ms (\`resolveOpenRouterCompletionTimeoutMs\`, non-html background) — bench uses 180_000 ms |
| Retry owner | \`summarizeTurnBatch\` up to 3 attempts (production only) — **bench: 0** |
| Fallback owner | \`resolveBackgroundMemoryFallbackModel\` — **bench: 0** |
| Temperature | 0.3 |
| max_tokens (bench) | 350 (quality bench parity) |
| Production extract max_tokens | unbounded (\`null\`) for \`background-memory-extract\` |
| Luna reasoning (production adapter) | \`reasoning: { effort: \"none\" }\`, \`reasoning_effort: \"none\"\` via \`adaptCheaperInferenceChatBody\` |
| Gemini bench reasoning | \`reasoning_effort: \"none\"\` |
| DeepSeek bench reasoning | \`thinking: { type: \"disabled\" }\` |
| Usage/cost extraction | \`parseCompatibleUsage\` in \`openRouterUsage.ts\` |
| TTFT | Non-streaming — \`TTFT_NOT_MEASURABLE\` |

## Call invariants

\`\`\`json
${JSON.stringify(invariants, null, 2)}
\`\`\`

## Reliability (per model, n=60)

${modelStats
  .map(
    (s) => `### ${s.label}
- VALID_SUCCESS: ${s.validSuccess}/60 (${fmtPct(s.validSuccessRate)})
- HARD_FAILURE: ${s.hardFailure}/60 (${fmtPct(s.hardFailureRate)})
- EMPTY_RESPONSE: ${s.emptyResponse} (${fmtPct(s.emptyResponseRate)})
- TIMEOUT: ${s.timeout} (${fmtPct(s.timeoutRate)})
- LENGTH_TRUNCATED (flag): ${s.lengthTruncated} (${fmtPct(s.lengthTruncationRate)})
- HTTP_ERROR: ${s.httpError} | PROVIDER_ERROR: ${s.providerError} | MALFORMED: ${s.malformed}`
  )
  .join("\n\n")}

## Latency (ms, all calls)

${modelStats
  .map(
    (s) => `### ${s.label}
- mean ${fmtMs(s.latencyAll.mean)} | median/P50 ${fmtMs(s.latencyAll.median)} | P90 ${fmtMs(s.latencyAll.p90)} | P95 ${fmtMs(s.latencyAll.p95)} | P99 ${fmtMs(s.latencyAll.p99)} (P99_DIRECTIONAL_ONLY)
- stdev ${fmtMs(s.latencyAll.stdev)} | min ${fmtMs(s.latencyAll.min)} | max ${fmtMs(s.latencyAll.max)}`
  )
  .join("\n\n")}

## Cost (USD, reported CheaperInference billing when present)

${modelStats
  .map(
    (s) => `### ${s.label}
- total ${fmtUsd(s.costTotal)} | avg/call ${fmtUsd(s.costAvg)} | median/call ${fmtUsd(s.costMedian)} | cost/valid-success ${fmtUsd(s.costPerValidSuccess)}`
  )
  .join("\n\n")}

## Notable failures

${notableFailures(rows).map((n) => `- ${n}`).join("\n") || "- (none flagged by automated screening rules)"}

## Artifacts

- \`RELIABILITY_SPEED_COMPARISON.md\`
- \`raw-results.jsonl\`
- \`run-metadata.json\`
- Fixtures reused (unchanged): \`docs/audits/4-model-korean-summary-quality/fixtures.json\`
`;

  writeFileSync(join(OUT_DIR, "RUN_REPORT.md"), runReport, "utf8");
  console.log("Generated reliability artifacts");
}

main();
