/**
 * Evaluate P0 pipeline parity gate vs D0 baseline.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateP0ParityGate,
  judgePostprocessPrimary,
  type PostprocessPipelineCapture,
} from "../src/lib/rpDiagnosticCanary";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const P0_DIR = join(ROOT, "01-postprocess/ds_pipeline_baseline");
const D0_BASELINE_AVG = 3187;

function loadMetrics(dir: string) {
  const out: unknown[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 2; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8")));
    }
  }
  return out as Array<{
    provider_raw_ws?: number;
    invalid?: boolean;
    api?: { finish_reason?: string; retry_count?: number; length_recovery_passes?: number };
  }>;
}

function loadPipelines(dir: string): PostprocessPipelineCapture[] {
  const out: PostprocessPipelineCapture[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 2; t++) {
      const p = join(dir, run, `turn${t}-pipeline.json`);
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, "utf8")) as {
        metrics?: PostprocessPipelineCapture["metrics"];
        pipeline?: Record<string, string>;
      };
      if (!raw.metrics) continue;
      const pl = raw.pipeline ?? {};
      out.push({
        provider_raw_merged: pl.provider_raw_merged ?? "",
        pre_normalize: pl.pre_normalize ?? "",
        post_normalize: pl.post_normalize ?? "",
        pre_display_grouping: pl.pre_display_grouping ?? "",
        post_display_grouping: pl.post_display_grouping ?? "",
        sse_final: pl.sse_final ?? "",
        db_saved: pl.db_saved ?? "",
        metrics: raw.metrics,
      });
    }
  }
  return out;
}

const rows = loadMetrics(P0_DIR).filter((r) => !r.invalid);
const parity = evaluateP0ParityGate({ p0Samples: rows, baselineAvg: D0_BASELINE_AVG });
const pipelines = loadPipelines(P0_DIR);
const postprocessVerdicts = pipelines.map((p) => judgePostprocessPrimary(p));

const finishBad = rows.filter((r) => {
  const fr = (r.api?.finish_reason ?? "").toLowerCase();
  return fr && fr !== "stop" && fr !== "end_turn";
}).length;
const retryBad = rows.filter((r) => (r.api?.retry_count ?? 0) > 0).length;
const recoveryBad = rows.filter((r) => (r.api?.length_recovery_passes ?? 0) > 0).length;

const result = {
  generated_at: new Date().toISOString(),
  pass:
    parity.pass &&
    finishBad === 0 &&
    retryBad === 0 &&
    recoveryBad === 0 &&
    rows.length >= 4,
  verdict: parity.pass ? "P0_PIPELINE_PARITY_PASS" : "PIPELINE_PARITY_FAIL",
  parity,
  n: rows.length,
  finish_bad: finishBad,
  retry_bad: retryBad,
  recovery_bad: recoveryBad,
  postprocess_screening: postprocessVerdicts,
  canonical_lengths: rows.map((r) => r.provider_raw_ws),
};

writeFileSync(join(ROOT, "00-integrity/P0_PARITY_GATE.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
