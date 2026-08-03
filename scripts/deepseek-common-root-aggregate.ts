/**
 * Aggregate DeepSeek common-root audit metrics with length-first gate ordering.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateLengthGate,
  evaluateSampleVerdict,
  RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES,
  RP_DIAGNOSTIC_MIN_FINAL_SAMPLES,
} from "../src/lib/rpDiagnosticCanary";

const ROOT =
  process.env.ART_ROOT ?? "/opt/cursor/artifacts/deepseek-common-root-audit";

type TurnMetric = {
  canonical_length_ws?: number;
  visible_canonical_length?: number;
  invalid?: boolean;
  invalid_reason?: string;
  quote_pair_count?: number;
  semantic_utterance_units_auto?: number;
  fragmentation_multiplier_auto?: number;
  resume_transitions_auto?: number;
  quote_blocks_per_1000_chars?: number;
  resume_transitions_per_1000_chars?: number;
  npc_subplot?: boolean;
  trailing_reaction_points?: number;
  scene_completion?: boolean;
  api?: {
    output_tokens?: number;
    finishReason?: string;
    finish_reason?: string;
    raw_equals_final?: boolean;
    lengthRecoveryPasses?: number;
    retry_count?: number;
  };
  auto_provider?: {
    quote_pair_count?: number;
    resume_transitions_auto?: number;
    fragmentation_multiplier_auto?: number;
    canonical_length_ws?: number;
    quote_blocks_per_1000_chars?: number;
    resume_transitions_per_1000_chars?: number;
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

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function aggregate(rows: TurnMetric[]) {
  const valid = rows.filter((r) => !r.invalid);
  if (valid.length === 0) return null;

  const canonicals = valid.map((r) => r.visible_canonical_length ?? r.canonical_length_ws ?? 0);
  const lengthGate = evaluateLengthGate(valid);
  const outputTokens = valid
    .map((r) => r.api?.output_tokens)
    .filter((n): n is number => typeof n === "number");
  const finishLength = valid.filter((r) => {
    const fr = (r.api?.finishReason ?? r.api?.finish_reason ?? "").toLowerCase();
    return fr === "length" || fr === "max_tokens";
  }).length;

  const avg = (fn: (r: TurnMetric) => number) =>
    valid.reduce((a, r) => a + fn(r), 0) / valid.length;

  const rawSubset = valid.filter((r) => (r.auto_provider?.canonical_length_ws ?? 0) >= 2700);
  const rawGate = evaluateLengthGate(
    rawSubset.map((r) => ({
      canonical_length_ws: r.auto_provider?.canonical_length_ws,
    }))
  );

  return {
    n: valid.length,
    invalid_excluded: rows.length - valid.length,
    ...lengthGate.stats,
    length_gate_pass: lengthGate.pass,
    length_invalid_reason: lengthGate.pass ? null : lengthGate.reason,
    output_tokens_avg:
      outputTokens.length > 0
        ? Math.round(outputTokens.reduce((a, b) => a + b, 0) / outputTokens.length)
        : null,
    finish_length_count: finishLength,
    quote_blocks_avg: Math.round(avg((r) => r.quote_pair_count ?? 0) * 10) / 10,
    quote_blocks_raw_avg: Math.round(
      avg((r) => r.auto_provider?.quote_pair_count ?? r.quote_pair_count ?? 0) * 10
    ) / 10,
    fragmentation_multiplier_median: median(
      valid.map((r) => r.fragmentation_multiplier_auto ?? 0)
    ),
    fragmentation_multiplier_raw_median: median(
      valid.map((r) => r.auto_provider?.fragmentation_multiplier_auto ?? 0)
    ),
    resume_transitions_median: median(valid.map((r) => r.resume_transitions_auto ?? 0)),
    resume_transitions_raw_median: median(
      valid.map((r) => r.auto_provider?.resume_transitions_auto ?? 0)
    ),
    quote_blocks_per_1000_chars: Math.round(avg((r) => r.quote_blocks_per_1000_chars ?? 0) * 100) / 100,
    resume_per_1000_chars:
      Math.round(avg((r) => r.resume_transitions_per_1000_chars ?? 0) * 100) / 100,
    quote_blocks_per_1000_raw: Math.round(
      avg((r) => r.auto_provider?.quote_blocks_per_1000_chars ?? 0) * 100
    ) / 100,
    resume_per_1000_raw: Math.round(
      avg((r) => r.auto_provider?.resume_transitions_per_1000_chars ?? 0) * 100
    ) / 100,
    npc_subplot_rate: `${valid.filter((r) => r.npc_subplot).length}/${valid.length}`,
    trailing_success: `${valid.filter((r) => (r.trailing_reaction_points ?? 0) >= 1).length}/${valid.length}`,
    scene_completion: `${valid.filter((r) => r.scene_completion).length}/${valid.length}`,
    length_qualified_subset_n: rawSubset.length,
    length_qualified_subset_gate: rawGate.pass,
    root_cause_verdict:
      lengthGate.pass && valid.length >= RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES
        ? "SCREENING_ALLOWED"
        : lengthGate.pass
          ? "INSUFFICIENT_SAMPLE"
          : "LENGTH_GATE_BLOCKED",
  };
}

function screeningVerdict(
  baseline: NonNullable<ReturnType<typeof aggregate>> | null,
  candidate: NonNullable<ReturnType<typeof aggregate>> | null
): string {
  if (!candidate) return "NOT_RUN";
  const sampleVerdict = evaluateSampleVerdict(candidate.n, "screening");
  if (sampleVerdict !== "COMPLETED") return sampleVerdict;
  if (!candidate.length_gate_pass) return "CANDIDATE_LENGTH_INVALID";
  if (!baseline?.length_gate_pass) return "BASELINE_LENGTH_INVALID";
  const resumeDelta =
    baseline.resume_transitions_raw_median === 0
      ? 0
      : ((candidate.resume_transitions_raw_median - baseline.resume_transitions_raw_median) /
          baseline.resume_transitions_raw_median) *
        100;
  const lenDrop =
    baseline.canonical_avg === 0
      ? 0
      : ((candidate.canonical_avg - baseline.canonical_avg) / baseline.canonical_avg) * 100;
  if (lenDrop < -15) return "CANDIDATE_LENGTH_INVALID";
  if (resumeDelta <= -25) return "EFFECT_CONFIRMED";
  return "NO_EFFECT_AT_THRESHOLD";
}

function main() {
  mkdirSync(ROOT, { recursive: true });

  let d0Reaudit: { d0_status?: string; audit_permission?: string } | null = null;
  const reauditPath = join(ROOT, "00-integrity/D0_LENGTH_REAUDIT.json");
  if (existsSync(reauditPath)) {
    d0Reaudit = JSON.parse(readFileSync(reauditPath, "utf8")) as typeof d0Reaudit;
  }

  const variants: Record<string, string> = {
    d0: "02-ds-real-production",
    length_baseline: "02-ds-length-normalized-baseline",
    p0: "01-postprocess/ds_postprocess_baseline",
    p1: "01-postprocess/ds_paragraph_normalize_bypass",
    d1: "03-ds-dialogue-control",
    d2: "04-ds-common-only",
  };

  const loaded: Record<string, ReturnType<typeof aggregate>> = {};
  for (const [k, sub] of Object.entries(variants)) {
    loaded[k] = aggregate(loadRunMetrics(join(ROOT, sub)));
  }

  const lengthBaseline = loaded.length_baseline;
  const auditPermission =
    lengthBaseline?.length_gate_pass && (lengthBaseline.n ?? 0) >= 6
      ? "FULL_COMMON_ROOT_MATRIX_ALLOWED"
      : d0Reaudit?.audit_permission ?? "LENGTH_BASELINE_NOT_READY";

  const out = {
    generated_at: new Date().toISOString(),
    min_screening_samples: RP_DIAGNOSTIC_MIN_SCREENING_SAMPLES,
    min_final_samples: RP_DIAGNOSTIC_MIN_FINAL_SAMPLES,
    d0_reaudit_status: d0Reaudit?.d0_status ?? "UNKNOWN",
    d0_previous_verdict_valid: false,
    audit_permission: auditPermission,
    length_diagnosis: process.env.LENGTH_DIAGNOSIS ?? "FLASH_EARLY_STOP_DESPITE_OWNER",
    variants: loaded,
    screening: {
      postprocess_bypass: {
        verdict: screeningVerdict(loaded.length_baseline ?? loaded.d0, loaded.p1),
      },
      dialogue_control: {
        verdict: screeningVerdict(loaded.length_baseline ?? loaded.d0, loaded.d1),
      },
      common_only: {
        verdict: screeningVerdict(loaded.length_baseline ?? loaded.d0, loaded.d2),
      },
    },
    verdict_order: [
      "sample count",
      "integrity",
      "length gate",
      "NPC",
      "fragmentation",
      "trailing response",
    ],
  };

  writeFileSync(join(ROOT, "FINAL_STATS.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main();
