/**
 * Aggregate DeepSeek common-root audit metrics — manual-first verdict ordering.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateLengthGate,
  evaluateSampleVerdict,
  evaluateP0ParityGate,
  evaluateScreeningEffect,
  evaluateCandidateLengthGate,
  judgePostprocessPrimary,
  RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES,
  RP_DIAGNOSTIC_MIN_FINAL_SAMPLES,
  type PostprocessPipelineCapture,
} from "../src/lib/rpDiagnosticCanary";

const ROOT =
  process.env.ART_ROOT ?? "/opt/cursor/artifacts/deepseek-common-root-audit";

type TurnMetric = {
  canonical_length_ws?: number;
  provider_raw_ws?: number;
  raw_quote_blocks?: number;
  manual_semantic_units?: number;
  manual_resume_transitions?: number;
  manual_fragmentation_multiplier?: number;
  manual_resume_per_1000_chars?: number;
  raw_quote_blocks_per_1000_chars?: number;
  auto_metric_unreliable?: string | null;
  invalid?: boolean;
  npc_subplot?: boolean;
  trailing_reaction_points?: number;
  scene_completion?: boolean;
  api?: {
    finish_reason?: string;
    length_recovery_passes?: number;
    retry_count?: number;
  };
};

function loadRunMetrics(dir: string): TurnMetric[] {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir).filter((d) => d.startsWith("run"));
  const out: TurnMetric[] = [];
  for (const run of runs) {
    for (let t = 1; t <= 4; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (!existsSync(p)) continue;
      out.push(JSON.parse(readFileSync(p, "utf8")) as TurnMetric);
    }
  }
  return out;
}

function loadPipelineCaptures(dir: string): PostprocessPipelineCapture[] {
  if (!existsSync(dir)) return [];
  const out: PostprocessPipelineCapture[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 4; t++) {
      const p = join(dir, run, `turn${t}-pipeline.json`);
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, "utf8")) as {
        metrics?: PostprocessPipelineCapture["metrics"];
        pipeline?: PostprocessPipelineCapture;
      };
      if (raw.metrics && raw.pipeline) {
        out.push({
          ...raw.pipeline,
          metrics: raw.metrics,
        } as PostprocessPipelineCapture);
      }
    }
  }
  return out;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function aggregate(rows: TurnMetric[]) {
  const valid = rows.filter((r) => !r.invalid);
  if (!valid.length) return null;

  const avg = (fn: (r: TurnMetric) => number) =>
    valid.reduce((a, r) => a + fn(r), 0) / valid.length;

  const lengthGate =
    valid.length >= 6
      ? evaluateLengthGate(valid)
      : evaluateCandidateLengthGate(valid, 3187);

  return {
    n: valid.length,
    sample_verdict: evaluateSampleVerdict(valid.length, valid.length >= 6 ? "final" : "screening"),
    canonical_avg: Math.round(avg((r) => r.provider_raw_ws ?? r.canonical_length_ws ?? 0)),
    manual_semantic_units_avg: Math.round(avg((r) => r.manual_semantic_units ?? 0) * 100) / 100,
    manual_resume_avg: Math.round(avg((r) => r.manual_resume_transitions ?? 0) * 100) / 100,
    manual_resume_median: median(valid.map((r) => r.manual_resume_transitions ?? 0)),
    manual_fragmentation_avg:
      Math.round(avg((r) => r.manual_fragmentation_multiplier ?? 0) * 100) / 100,
    manual_fragmentation_median: median(
      valid.map((r) => r.manual_fragmentation_multiplier ?? 0)
    ),
    manual_resume_per_1000_avg:
      Math.round(avg((r) => r.manual_resume_per_1000_chars ?? 0) * 100) / 100,
    quote_blocks_per_1000_avg:
      Math.round(avg((r) => r.raw_quote_blocks_per_1000_chars ?? 0) * 100) / 100,
    auto_metric_unreliable_count: valid.filter((r) => r.auto_metric_unreliable).length,
    length_gate_pass: lengthGate.pass,
    length_invalid_reason: lengthGate.pass ? null : lengthGate.reason,
    npc_subplot_rate: `${valid.filter((r) => r.npc_subplot).length}/${valid.length}`,
    trailing_success: `${valid.filter((r) => (r.trailing_reaction_points ?? 0) >= 1).length}/${valid.length}`,
    scene_completion: `${valid.filter((r) => r.scene_completion).length}/${valid.length}`,
  };
}

function main() {
  mkdirSync(ROOT, { recursive: true });

  let d0V2: { manual_resume_median?: number; manual_fragmentation_median?: number } | null =
    null;
  const d0Path = join(ROOT, "02-ds-pro-real-production/METRICS_V2.json");
  if (existsSync(d0Path)) {
    d0V2 = JSON.parse(readFileSync(d0Path, "utf8")) as typeof d0V2;
  }

  const proD0 = aggregate(loadRunMetrics(join(ROOT, "02-ds-pro-real-production")));
  const p0Rows = loadRunMetrics(join(ROOT, "01-postprocess/ds_pipeline_baseline"));
  const p1Rows = loadRunMetrics(join(ROOT, "01-postprocess/ds_display_grouping_bypass"));
  const p0Pipelines = loadPipelineCaptures(join(ROOT, "01-postprocess/ds_pipeline_baseline"));

  const baselineAvg = proD0?.canonical_avg ?? 3187;
  const p0Agg = aggregate(p0Rows);
  const p0Parity = evaluateP0ParityGate({
    p0Samples: p0Rows,
    baselineAvg,
  });

  const postprocessVerdicts = p0Pipelines.map((c) => judgePostprocessPrimary(c));
  const postprocessPrimary =
    postprocessVerdicts.includes("TEXT_MUTATION_CREATES_FRAGMENTATION")
      ? "TEXT_MUTATION_CREATES_FRAGMENTATION"
      : postprocessVerdicts.includes("DISPLAY_ONLY_PARAGRAPH_AMPLIFIER")
        ? "DISPLAY_ONLY_PARAGRAPH_AMPLIFIER"
        : postprocessVerdicts.includes("POSTPROCESS_NOT_PRIMARY")
          ? "POSTPROCESS_NOT_PRIMARY"
          : p0Rows.length >= RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES
            ? "INSUFFICIENT_PIPELINE_EVIDENCE"
            : "NOT_RUN";

  const variants: Record<string, ReturnType<typeof aggregate>> = {
    pro_d0: proD0,
    p0: p0Agg,
    p1: aggregate(p1Rows),
    d1: aggregate(loadRunMetrics(join(ROOT, "03-ds-dialogue-control"))),
    d2a: aggregate(loadRunMetrics(join(ROOT, "04-ds-common-only"))),
    d2b: aggregate(loadRunMetrics(join(ROOT, "04-ds-common-only-length-probe"))),
    c1: aggregate(loadRunMetrics(join(ROOT, "06-common-greeting"))),
    c2: aggregate(loadRunMetrics(join(ROOT, "08-common-layout"))),
    c3: aggregate(loadRunMetrics(join(ROOT, "09-common-length-owner"))),
    c4: aggregate(loadRunMetrics(join(ROOT, "10-common-scene-directive"))),
    c5: aggregate(loadRunMetrics(join(ROOT, "11-common-rp-style"))),
  };

  const baselineManual = {
    manual_resume_per_1000: d0V2?.manual_resume_median
      ? (d0V2 as { manual_resume_per_1000_avg?: number }).manual_resume_per_1000_avg
      : proD0?.manual_resume_per_1000_avg,
    manual_fragmentation: d0V2?.manual_fragmentation_median ?? proD0?.manual_fragmentation_median,
  };

  const screening = {
    d1: evaluateScreeningEffect(baselineManual, {
      manual_resume_per_1000: variants.d1?.manual_resume_per_1000_avg,
      manual_fragmentation: variants.d1?.manual_fragmentation_median,
    }),
    d2a: evaluateScreeningEffect(baselineManual, {
      manual_resume_per_1000: variants.d2a?.manual_resume_per_1000_avg,
      manual_fragmentation: variants.d2a?.manual_fragmentation_median,
    }),
  };

  const out = {
    generated_at: new Date().toISOString(),
    diagnostic_model: "deepseek-v4-pro",
    flash_d0_status: "SHORT_OUTPUT_SMOKE_ONLY",
    flash_matrix_status: "ON_HOLD",
    metric_priority: [
      "provider RAW manual review",
      "manual resume / manual fragmentation",
      "RAW normalized metrics",
      "auto metrics",
      "display grouping",
    ],
    pro_d0_manual: d0V2,
    p0_parity_gate: p0Parity,
    postprocess_primary_verdict: postprocessPrimary,
    variants,
    screening,
    verdict_order: [
      "sample count",
      "request integrity",
      "length gate",
      "RAW manual resume",
      "RAW manual fragmentation",
      "NPC",
      "trailing reaction",
      "character voice",
    ],
    production_db_apply: false,
    general_rollout: false,
    auto_merge: false,
  };

  writeFileSync(join(ROOT, "FINAL_STATS.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main();
