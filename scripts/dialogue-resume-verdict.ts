/**
 * Post-sanitizer dialogue-resume candidate gate + length baseline verdict.
 * Reads harness all_runs.json / turn*-metrics.json under OUT dirs.
 *
 * Env:
 *   BASELINE_DIR, CANDIDATE_DIR (artifact roots with runN/turn*-metrics.json)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Row = {
  turn?: number;
  provider_raw_ws?: number;
  canonical_length_ws?: number;
  manual_resume_transitions?: number;
  manual_fragmentation_multiplier?: number;
  manual_resume_per_1000_chars?: number;
  dialogue_chars?: number;
  narration_ratio_pct?: number;
  npc_subplot?: boolean;
  external_dialogue_blocks?: number;
  trailing_reaction_points?: number;
  scene_completion?: boolean;
  api?: {
    finish_reason?: string | null;
    length_recovery_passes?: number;
    retry_count?: number;
  };
};

function loadRows(root: string): Row[] {
  const rows: Row[] = [];
  for (let r = 1; r <= 12; r++) {
    for (let t = 1; t <= 4; t++) {
      const p = join(root, `run${r}`, `turn${t}-metrics.json`);
      if (!existsSync(p)) continue;
      rows.push(JSON.parse(readFileSync(p, "utf8")) as Row);
    }
  }
  return rows;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function summarize(rows: Row[]) {
  const lens = rows.map((r) => r.provider_raw_ws ?? r.canonical_length_ws ?? 0);
  const resumes = rows.map((r) => r.manual_resume_transitions ?? 0);
  const resumePer1k = rows.map((r) => r.manual_resume_per_1000_chars ?? 0);
  const frags = rows.map((r) => r.manual_fragmentation_multiplier ?? 0);
  const dlgShare = rows.map((r) => {
    const len = r.provider_raw_ws ?? r.canonical_length_ws ?? 0;
    const d = r.dialogue_chars ?? 0;
    return len > 0 ? (d / len) * 100 : 0;
  });
  const narrShare = rows.map((r) => r.narration_ratio_pct ?? 100 - (dlgShare[rows.indexOf(r)] ?? 0));
  const finishStop = rows.filter((r) => (r.api?.finish_reason ?? "stop") === "stop").length;
  const retry = rows.reduce((a, r) => a + (r.api?.retry_count ?? 0), 0);
  const recovery = rows.reduce((a, r) => a + (r.api?.length_recovery_passes ?? 0), 0);
  const npc = rows.filter((r) => r.npc_subplot).length;
  const external = rows.reduce((a, r) => a + (r.external_dialogue_blocks ?? 0), 0);
  const reaction = rows.filter((r) => (r.trailing_reaction_points ?? 0) > 0).length;
  const sceneOk = rows.filter((r) => r.scene_completion).length;
  return {
    n: rows.length,
    length_avg: avg(lens),
    length_median: median(lens),
    length_min: lens.length ? Math.min(...lens) : 0,
    length_max: lens.length ? Math.max(...lens) : 0,
    count_ge_3000: lens.filter((x) => x >= 3000).length,
    count_ge_2700: lens.filter((x) => x >= 2700).length,
    count_lt_2400: lens.filter((x) => x < 2400).length,
    resume_avg: avg(resumes),
    resume_median: median(resumes),
    resume_per_1000_avg: avg(resumePer1k),
    fragmentation_avg: avg(frags),
    dialogue_share_avg: avg(dlgShare),
    narration_share_avg: avg(narrShare),
    finish_reason_stop: finishStop,
    retry_total: retry,
    recovery_total: recovery,
    npc_subplot_count: npc,
    external_speaker_blocks: external,
    trailing_reaction_count: reaction,
    scene_completion_count: sceneOk,
  };
}

function main() {
  const baselineDir =
    process.env.BASELINE_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/19-dialogue-resume/post_fix_production_baseline";
  const candidateDir =
    process.env.CANDIDATE_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/19-dialogue-resume/common_dialogue_resume_single_owner";
  const outDir =
    process.env.OUT_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/19-dialogue-resume";

  const baseline = summarize(loadRows(baselineDir));
  const candidate = summarize(loadRows(candidateDir));

  const resumeDelta =
    baseline.resume_per_1000_avg === 0
      ? 0
      : (candidate.resume_per_1000_avg - baseline.resume_per_1000_avg) /
        baseline.resume_per_1000_avg;
  const fragDelta =
    baseline.fragmentation_avg === 0
      ? 0
      : (candidate.fragmentation_avg - baseline.fragmentation_avg) /
        baseline.fragmentation_avg;
  const lengthDrop =
    baseline.length_avg === 0
      ? 0
      : (candidate.length_avg - baseline.length_avg) / baseline.length_avg;

  const lengthGatePass =
    candidate.n >= 6 &&
    candidate.length_avg >= 2700 &&
    candidate.count_lt_2400 <= 1 &&
    lengthDrop >= -0.1 &&
    candidate.finish_reason_stop === candidate.n &&
    candidate.retry_total === 0 &&
    candidate.recovery_total === 0;

  const dialogueGatePass =
    lengthGatePass &&
    resumeDelta <= -0.3 &&
    fragDelta <= -0.15 &&
    candidate.resume_median <= 3 &&
    candidate.dialogue_share_avg >= 10 &&
    candidate.dialogue_share_avg <= 30 &&
    candidate.narration_share_avg >= 65 &&
    candidate.narration_share_avg <= 90 &&
    candidate.npc_subplot_count <= baseline.npc_subplot_count &&
    candidate.trailing_reaction_count >= Math.max(0, baseline.trailing_reaction_count - 1) &&
    candidate.scene_completion_count >= Math.max(0, baseline.scene_completion_count - 1) &&
    // Length drop must not be the sole “improvement” driver for dialogue reduction.
    !(lengthDrop < -0.05 && resumeDelta > -0.3);

  let dialogueVerdict: string;
  if (!lengthGatePass) dialogueVerdict = "CANDIDATE_LENGTH_INVALID";
  else if (dialogueGatePass) dialogueVerdict = "COMMON_DIALOGUE_RESUME_OWNER_CONFIRMED";
  else dialogueVerdict = "DIALOGUE_RESUME_IMPROVEMENT_INSUFFICIENT";

  const postFixLengthPass =
    baseline.n >= 6 &&
    baseline.length_avg >= 3000 &&
    baseline.count_ge_2700 >= 5 &&
    baseline.count_lt_2400 === 0 &&
    baseline.finish_reason_stop === baseline.n &&
    baseline.retry_total === 0 &&
    baseline.recovery_total === 0;

  const lengthVerdict = postFixLengthPass
    ? "POST_FIX_LENGTH_BASELINE_PASS"
    : "POST_FIX_LENGTH_BASELINE_FAIL";

  let nextIsolated = "none";
  if (dialogueVerdict === "COMMON_DIALOGUE_RESUME_OWNER_CONFIRMED") {
    nextIsolated = "cross_check_terra_muse_4_outputs_each";
  } else if (dialogueVerdict === "DIALOGUE_RESUME_IMPROVEMENT_INSUFFICIENT") {
    nextIsolated = "deepseek_pro_extras_ablation_one_at_a_time";
  } else if (dialogueVerdict === "CANDIDATE_LENGTH_INVALID") {
    nextIsolated = "separate_length_owner_audit_after_dialogue_experiment";
  }
  if (lengthVerdict === "POST_FIX_LENGTH_BASELINE_FAIL") {
    nextIsolated =
      nextIsolated === "none"
        ? "separate_length_owner_audit"
        : `${nextIsolated}+separate_length_owner_audit`;
  }
  if (baseline.npc_subplot_count > 0 || candidate.npc_subplot_count > 0) {
    nextIsolated = `${nextIsolated}+early_scene_npc_suppression_canary`;
  }

  const report = {
    production_baseline_n: baseline.n,
    candidate_n: candidate.n,
    baseline_length: baseline.length_avg,
    candidate_length: candidate.length_avg,
    baseline_manual_resume: baseline.resume_avg,
    candidate_manual_resume: candidate.resume_avg,
    baseline_manual_resume_median: baseline.resume_median,
    candidate_manual_resume_median: candidate.resume_median,
    baseline_manual_resume_per_1000: baseline.resume_per_1000_avg,
    candidate_manual_resume_per_1000: candidate.resume_per_1000_avg,
    resume_delta_pct: Math.round(resumeDelta * 1000) / 10,
    baseline_fragmentation: baseline.fragmentation_avg,
    candidate_fragmentation: candidate.fragmentation_avg,
    fragmentation_delta_pct: Math.round(fragDelta * 1000) / 10,
    dialogue_share_baseline: baseline.dialogue_share_avg,
    dialogue_share_candidate: candidate.dialogue_share_avg,
    narration_share_baseline: baseline.narration_share_avg,
    narration_share_candidate: candidate.narration_share_avg,
    NPC_baseline: baseline.npc_subplot_count,
    NPC_candidate: candidate.npc_subplot_count,
    reaction_point_baseline: baseline.trailing_reaction_count,
    reaction_point_candidate: candidate.trailing_reaction_count,
    scene_completion_baseline: baseline.scene_completion_count,
    scene_completion_candidate: candidate.scene_completion_count,
    length_drop_pct: Math.round(lengthDrop * 1000) / 10,
    dialogue_verdict: dialogueVerdict,
    length_verdict: lengthVerdict,
    next_isolated_problem: nextIsolated,
    baseline,
    candidate,
    production_db_apply: "NO",
    general_rollout: "NO",
    auto_merge: "NO",
    auto_deploy: "NO",
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "VERDICT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
