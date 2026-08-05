/**
 * Early-scene NPC intrusion — relationship-axis-only candidate gate.
 *
 * Env: BASELINE_DIR, CANDIDATE_DIR, OUT_DIR
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Row = {
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

function summarize(rows: Row[]) {
  const lens = rows.map((r) => r.provider_raw_ws ?? r.canonical_length_ws ?? 0);
  const resumePer1k = rows.map((r) => r.manual_resume_per_1000_chars ?? 0);
  const frags = rows.map((r) => r.manual_fragmentation_multiplier ?? 0);
  const dlgShare = rows.map((r) => {
    const len = r.provider_raw_ws ?? r.canonical_length_ws ?? 0;
    const d = r.dialogue_chars ?? 0;
    return len > 0 ? (d / len) * 100 : 0;
  });
  return {
    n: rows.length,
    length_avg: avg(lens),
    count_lt_2400: lens.filter((x) => x < 2400).length,
    resume_per_1000_avg: avg(resumePer1k),
    fragmentation_avg: avg(frags),
    dialogue_share_avg: avg(dlgShare),
    narration_share_avg: avg(rows.map((r) => r.narration_ratio_pct ?? 0)),
    finish_reason_stop: rows.filter((r) => (r.api?.finish_reason ?? "stop") === "stop").length,
    retry_total: rows.reduce((a, r) => a + (r.api?.retry_count ?? 0), 0),
    recovery_total: rows.reduce((a, r) => a + (r.api?.length_recovery_passes ?? 0), 0),
    npc_subplot_count: rows.filter((r) => r.npc_subplot).length,
    external_speaker_blocks: rows.reduce((a, r) => a + (r.external_dialogue_blocks ?? 0), 0),
    trailing_reaction_count: rows.filter((r) => (r.trailing_reaction_points ?? 0) > 0).length,
  };
}

function main() {
  const baselineDir =
    process.env.BASELINE_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/19-dialogue-resume/post_fix_production_baseline";
  const candidateDir =
    process.env.CANDIDATE_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/20-early-npc-axis/early_relationship_axis_only";
  const outDir =
    process.env.OUT_DIR ??
    "/opt/cursor/artifacts/deepseek-common-root-audit/20-early-npc-axis";

  const baseline = summarize(loadRows(baselineDir));
  const candidate = summarize(loadRows(candidateDir));

  const lengthDrop =
    baseline.length_avg === 0
      ? 0
      : (candidate.length_avg - baseline.length_avg) / baseline.length_avg;
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
  const npcReduction =
    baseline.npc_subplot_count === 0
      ? candidate.npc_subplot_count === 0
        ? 1
        : 0
      : (baseline.npc_subplot_count - candidate.npc_subplot_count) /
        baseline.npc_subplot_count;

  const lengthOk =
    candidate.n >= 6 &&
    candidate.length_avg >= 3000 &&
    candidate.count_lt_2400 === 0 &&
    lengthDrop >= -0.1 &&
    candidate.finish_reason_stop === candidate.n &&
    candidate.retry_total === 0 &&
    candidate.recovery_total === 0;

  const qualityOk =
    resumeDelta <= 0.15 &&
    fragDelta <= 0.15 &&
    candidate.dialogue_share_avg >= 10 &&
    candidate.dialogue_share_avg <= 25 &&
    candidate.narration_share_avg >= 75 &&
    candidate.narration_share_avg <= 90;

  const npcOk =
    candidate.npc_subplot_count <= 1 ||
    npcReduction >= 0.5;

  const reactionOk = candidate.trailing_reaction_count >= 4;
  const externalNotWorse =
    candidate.external_speaker_blocks <= baseline.external_speaker_blocks;

  let npcVerdict: string;
  if (!lengthOk) npcVerdict = "CANDIDATE_LENGTH_INVALID";
  else if (!qualityOk) npcVerdict = "QUALITY_REGRESSION";
  else if (!npcOk || !reactionOk || !externalNotWorse)
    npcVerdict = "NPC_REDUCTION_INSUFFICIENT";
  else npcVerdict = "EARLY_RELATIONSHIP_AXIS_CONFIRMED";

  let next = "none";
  if (npcVerdict === "EARLY_RELATIONSHIP_AXIS_CONFIRMED") {
    next = "cross_check_terra_muse_4_outputs_each";
  } else if (
    npcVerdict === "NPC_REDUCTION_INSUFFICIENT" ||
    npcVerdict === "QUALITY_REGRESSION"
  ) {
    next = "explicit_early_scene_npc_suppression_sentence_experiment";
  } else if (npcVerdict === "CANDIDATE_LENGTH_INVALID") {
    next = "revisit_after_length_stability_or_retry_candidate";
  }
  // After NPC audit ends (pass or fail path that moves on): Pro extras ablation
  if (npcVerdict !== "CANDIDATE_LENGTH_INVALID") {
    next = `${next}+deepseek_pro_extras_ablation_one_at_a_time`;
  }

  const report = {
    baseline_NPC: baseline.npc_subplot_count,
    candidate_NPC: candidate.npc_subplot_count,
    external_speakers_baseline: baseline.external_speaker_blocks,
    external_speakers_candidate: candidate.external_speaker_blocks,
    administrative_subplot_note:
      "counted via harness npc_subplot / external_dialogue_blocks heuristics; manual RAW review recommended",
    baseline_length: baseline.length_avg,
    candidate_length: candidate.length_avg,
    baseline_resume_per_1000: baseline.resume_per_1000_avg,
    candidate_resume_per_1000: candidate.resume_per_1000_avg,
    resume_delta_pct: Math.round(resumeDelta * 1000) / 10,
    baseline_fragmentation: baseline.fragmentation_avg,
    candidate_fragmentation: candidate.fragmentation_avg,
    fragmentation_delta_pct: Math.round(fragDelta * 1000) / 10,
    dialogue_share_baseline: baseline.dialogue_share_avg,
    dialogue_share_candidate: candidate.dialogue_share_avg,
    narration_share_baseline: baseline.narration_share_avg,
    narration_share_candidate: candidate.narration_share_avg,
    reaction_point_baseline: baseline.trailing_reaction_count,
    reaction_point_candidate: candidate.trailing_reaction_count,
    npc_reduction_pct: Math.round(npcReduction * 1000) / 10,
    length_drop_pct: Math.round(lengthDrop * 1000) / 10,
    NPC_verdict: npcVerdict,
    next_isolated_problem: next,
    length_owner_audit: "NOT_NEEDED — production baseline passed",
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
