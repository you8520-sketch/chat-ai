/**
 * Aggregate DeepSeek common-root audit metrics with INSUFFICIENT_SAMPLE guardrails.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSampleVerdict,
  RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES,
  RP_DIAGNOSTIC_MIN_FINAL_SAMPLES,
} from "../src/lib/rpDiagnosticCanary";

const ROOT =
  process.env.ART_ROOT ?? "/opt/cursor/artifacts/deepseek-common-root-audit";

type MetricsRow = {
  quote_pair_count?: number;
  semantic_utterance_units_auto?: number;
  fragmentation_multiplier_auto?: number;
  resume_transitions_auto?: number;
  canonical_length_ws?: number;
  npc_subplot?: boolean;
  external_dialogue_blocks?: number;
  trailing_reaction_points?: number;
  scene_completion?: boolean;
  invalid?: boolean;
  invalid_reason?: string;
};

function loadVariantMetrics(dir: string): MetricsRow[] {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir).filter((d) => d.startsWith("run"));
  const out: MetricsRow[] = [];
  for (const run of runs) {
    for (let t = 1; t <= 4; t++) {
      const p = join(dir, run, `metrics.json`);
      const turnP = join(dir, run, `turn${t}-metrics.json`);
      const path = existsSync(turnP) ? turnP : existsSync(p) ? p : null;
      if (!path) continue;
      out.push(JSON.parse(readFileSync(path, "utf8")) as MetricsRow);
    }
  }
  return out;
}

function loadRunMetrics(dir: string): MetricsRow[] {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir).filter((d) => d.startsWith("run"));
  const out: MetricsRow[] = [];
  for (const run of runs) {
    for (let t = 1; t <= 4; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (!existsSync(p)) continue;
      out.push(JSON.parse(readFileSync(p, "utf8")) as MetricsRow);
    }
  }
  return out;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function aggregate(rows: MetricsRow[]) {
  const valid = rows.filter((r) => !r.invalid);
  if (valid.length === 0) return null;
  const avg = (fn: (r: MetricsRow) => number) =>
    valid.reduce((a, r) => a + fn(r), 0) / valid.length;
  return {
    n: valid.length,
    invalid_excluded: rows.length - valid.length,
    quote_pairs_avg: Math.round(avg((r) => r.quote_pair_count ?? 0) * 10) / 10,
    semantic_units_avg: Math.round(avg((r) => r.semantic_utterance_units_auto ?? 0) * 10) / 10,
    fragmentation_multiplier_median: median(
      valid.map((r) => r.fragmentation_multiplier_auto ?? 0)
    ),
    resume_transitions_median: median(valid.map((r) => r.resume_transitions_auto ?? 0)),
    resume_transitions_avg: Math.round(avg((r) => r.resume_transitions_auto ?? 0) * 10) / 10,
    canonical_avg: Math.round(avg((r) => r.canonical_length_ws ?? 0)),
    npc_subplot_rate: `${valid.filter((r) => r.npc_subplot).length}/${valid.length}`,
    trailing_success: `${valid.filter((r) => (r.trailing_reaction_points ?? 0) >= 1).length}/${valid.length}`,
    scene_completion: `${valid.filter((r) => r.scene_completion).length}/${valid.length}`,
  };
}

function compareEffect(
  baseline: NonNullable<ReturnType<typeof aggregate>>,
  candidate: NonNullable<ReturnType<typeof aggregate>>
) {
  const resumeDelta =
    baseline.resume_transitions_avg === 0
      ? 0
      : ((candidate.resume_transitions_avg - baseline.resume_transitions_avg) /
          baseline.resume_transitions_avg) *
        100;
  const fragDelta =
    baseline.fragmentation_multiplier_median === 0
      ? 0
      : ((candidate.fragmentation_multiplier_median -
          baseline.fragmentation_multiplier_median) /
          baseline.fragmentation_multiplier_median) *
        100;
  const lenOk = candidate.canonical_avg >= baseline.canonical_avg * 0.85;
  return { resume_delta_pct: resumeDelta, fragmentation_delta_pct: fragDelta, lenOk };
}

function screeningVerdict(
  baseline: NonNullable<ReturnType<typeof aggregate>> | null,
  candidate: NonNullable<ReturnType<typeof aggregate>> | null,
  kind: "screening" | "final"
): string {
  if (!candidate) return "NOT_RUN";
  const verdict = evaluateSampleVerdict(candidate.n, kind);
  if (verdict !== "COMPLETED") return verdict;
  if (!baseline) return "INSUFFICIENT_SAMPLE";
  const fx = compareEffect(baseline, candidate);
  if (fx.resume_delta_pct <= -25 && fx.fragmentation_delta_pct <= -25 && fx.lenOk) {
    return "EFFECT_CONFIRMED";
  }
  return "NO_EFFECT_AT_THRESHOLD";
}

function main() {
  mkdirSync(ROOT, { recursive: true });
  const variants: Record<string, string> = {
    p0: "01-postprocess/ds_postprocess_baseline",
    p1: "01-postprocess/ds_paragraph_normalize_bypass",
    d0: "02-ds-real-production",
    d1: "03-ds-dialogue-control",
    d2: "04-ds-common-only",
  };

  const loaded: Record<string, ReturnType<typeof aggregate>> = {};
  for (const [k, sub] of Object.entries(variants)) {
    loaded[k] = aggregate(loadRunMetrics(join(ROOT, sub)));
  }

  const priorTerraStatus = {
    prior_terra_dialogue_root: "INCOMPLETE_EXPERIMENT_NO_FINAL_VERDICT",
    note: "Prior Terra verdicts (NO_STABLE_DIALOGUE_FIX_FOUND, DIALOGUE_NATIVE_LIKELY, GREETING_RHYTHM_NOT_PRIMARY) are not final.",
  };

  const screening: Record<string, unknown> = {};
  const baseline = loaded.p0 ?? loaded.d0;
  for (const [label, key] of [
    ["postprocess_bypass", "p1"],
    ["dialogue_control", "d1"],
    ["common_only", "d2"],
  ] as const) {
    screening[label] = {
      verdict: screeningVerdict(baseline, loaded[key], "screening"),
      ...(loaded[key] ?? { n: 0 }),
    };
  }

  const finalVerdict = screeningVerdict(loaded.d0, loaded.d2, "final");

  const out = {
    generated_at: new Date().toISOString(),
    min_screening_samples: RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES,
    min_final_samples: RP_DIAGNOSTIC_MIN_FINAL_SAMPLES,
    prior_terra: priorTerraStatus,
    variants: loaded,
    screening,
    final_cross_check: { verdict: finalVerdict },
  };

  writeFileSync(join(ROOT, "FINAL_STATS.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main();
