/**
 * Active screening / confirmation verdict for structured_scene_focus_active_dyad.
 *
 * Env: CANDIDATE_DIR, EXPECTED_N (4|6), SCREEN_LABEL (screen|confirm), ART_ROOT
 *
 * Reads harness all_runs.json: [{ run, chatId, metrics: [turn metrics...] }]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CANDIDATE_DIR = process.env.CANDIDATE_DIR!;
const EXPECTED_N = Number(process.env.EXPECTED_N ?? "4");
const SCREEN_LABEL = process.env.SCREEN_LABEL ?? "screen";
const ART_ROOT =
  process.env.ART_ROOT ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/27-structured-scene-focus";
const BASELINE_AVG = 3532;
const BASELINE_CORE = 3203;

type Row = {
  id: string;
  len: number;
  core: number;
  npc: boolean;
  ext: number;
  admin: number;
  resume_per_1000: number;
  frag: number;
  dlg: number;
  narr: number;
  reaction: number;
  finish: string;
  retry: number;
  recovery: number;
  sceneFocusState: string | null;
  sceneFocusApplied: boolean;
  diagnostics: unknown;
};

function extractRows(all: unknown): Row[] {
  const runs = Array.isArray(all) ? all : (all as { runs?: unknown[] }).runs ?? [];
  const rows: Row[] = [];
  for (const run of runs as Array<{ run?: number; metrics?: any[] }>) {
    const runId = run.run ?? rows.length + 1;
    for (const m of run.metrics ?? []) {
      const turn = m.turn ?? 0;
      const len = Number(m.provider_raw_ws ?? m.canonical_length_ws ?? 0);
      const dlgChars = Number(m.dialogue_chars ?? 0);
      const narrChars = Number(m.narration_chars ?? 0);
      const totalChars = dlgChars + narrChars || len;
      const dlg =
        typeof m.dialogue_ratio_pct === "number"
          ? m.dialogue_ratio_pct / 100
          : totalChars
            ? dlgChars / totalChars
            : 0;
      // narration_ratio_pct in harness is actually often dialogue share mislabeled —
      // recompute from chars when present.
      const narr = totalChars ? narrChars / totalChars : 1 - dlg;
      const resume =
        Number(m.manual_resume_per_1000_chars ?? 0) ||
        (len > 0
          ? (Number(m.manual_resume_transitions ?? 0) / len) * 1000
          : 0);
      const integrity = m.integrity ?? {};
      const pipelineIntegrity =
        (existsSync(join(CANDIDATE_DIR, `run${runId}`, `turn${turn}-pipeline.json`))
          ? JSON.parse(
              readFileSync(
                join(CANDIDATE_DIR, `run${runId}`, `turn${turn}-pipeline.json`),
                "utf8"
              )
            )?.integrity
          : null) ?? integrity;
      rows.push({
        id: `run${runId}/turn${turn}`,
        len,
        // core-scene proxy: total minus rough external dialogue chars (heuristic)
        core: Math.max(
          0,
          len - Number(m.external_dialogue_blocks ?? 0) * 80
        ),
        npc: Boolean(m.npc_subplot),
        ext: Number(m.external_dialogue_blocks ?? 0),
        admin: Number(m.administrative_subplot ?? 0),
        resume_per_1000: resume,
        frag: Number(m.manual_fragmentation_multiplier ?? m.fragmentation_multiplier_auto ?? 0),
        dlg,
        narr,
        reaction: Number(m.trailing_reaction_points ?? 0),
        finish: String(m.api?.finish_reason ?? "stop"),
        retry: Number(m.api?.retry_count ?? 0),
        recovery: Number(m.api?.length_recovery_passes ?? 0),
        sceneFocusState: pipelineIntegrity?.sceneFocusState ?? null,
        sceneFocusApplied: Boolean(pipelineIntegrity?.sceneFocusApplied),
        diagnostics: pipelineIntegrity?.sceneFocusDiagnostics ?? null,
      });
    }
  }
  return rows;
}

function avg(nums: number[]): number {
  return nums.length
    ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000
    : 0;
}

function main() {
  mkdirSync(ART_ROOT, { recursive: true });
  const all = JSON.parse(readFileSync(join(CANDIDATE_DIR, "all_runs.json"), "utf8"));
  const rows = extractRows(all);
  const n = rows.length;

  const npcCount = rows.filter((r) => r.npc).length;
  const extTotal = rows.reduce((a, r) => a + r.ext, 0);
  const adminTotal = rows.reduce((a, r) => a + r.admin, 0);
  const avgLen = avg(rows.map((r) => r.len));
  const avgCore = avg(rows.map((r) => r.core));
  const lt2400 = rows.filter((r) => r.len < 2400).length;
  const ge2700 = rows.filter((r) => r.len >= 2700).length;
  const lengthDrop = (BASELINE_AVG - avgLen) / BASELINE_AVG;
  const resume = avg(rows.map((r) => r.resume_per_1000));
  const frag = avg(rows.map((r) => r.frag));
  const dlgPct = avg(rows.map((r) => r.dlg * 100));
  const narrPct = avg(rows.map((r) => r.narr * 100));
  const reaction = rows.filter((r) => r.reaction > 0).length;
  const finishOk = rows.every(
    (r) => !r.finish || r.finish === "stop" || r.finish === "end_turn"
  );
  const retryOk = rows.every((r) => r.retry === 0 && r.recovery === 0);
  const focusApplied = rows.filter((r) => r.sceneFocusApplied).length;
  const turn1 = rows.filter((r) => /\/turn1$/.test(r.id));
  const turn2 = rows.filter((r) => /\/turn2$/.test(r.id));
  const turn1Avg = avg(turn1.map((r) => r.len));
  const turn2Avg = avg(turn2.map((r) => r.len));
  const turn1Lt2400 = turn1.filter((r) => r.len < 2400).length;

  const screen = EXPECTED_N <= 4;
  const mode = process.env.VERDICT_MODE ?? "concrete_beats";
  const concreteMode = mode === "concrete_beats";
  const neutralMode = mode === "neutral_world_motion";
  const baseEngineMode = mode === "base_engine_preserved";

  // Drop incomplete finish from valid n for concrete screening.
  const validRows = concreteMode
    ? rows.filter((r) => r.finish === "stop" || r.finish === "end_turn")
    : rows;
  const vn = validRows.length;
  const vNpc = validRows.filter((r) => r.npc).length;
  const vExt = validRows.reduce((a, r) => a + r.ext, 0);
  const vAvgLen = avg(validRows.map((r) => r.len));
  const vAvgCore = avg(validRows.map((r) => r.core));
  const vLt2400 = validRows.filter((r) => r.len < 2400).length;
  const vTurn1 = validRows.filter((r) => /\/turn1$/.test(r.id));
  const vTurn1Avg = avg(vTurn1.map((r) => r.len));
  const vTurn1Min = vTurn1.length ? Math.min(...vTurn1.map((r) => r.len)) : 0;
  const vLengthDrop = (BASELINE_AVG - vAvgLen) / BASELINE_AVG;
  const vResume = avg(validRows.map((r) => r.resume_per_1000));
  const vFrag = avg(validRows.map((r) => r.frag));
  const vDlg = avg(validRows.map((r) => r.dlg * 100));
  const vNarr = avg(validRows.map((r) => r.narr * 100));
  const vReaction = validRows.filter((r) => r.reaction > 0).length;

  let verdict = screen
    ? concreteMode
      ? "CONCRETE_BEAT_SCREEN_PASS"
      : neutralMode
        ? "NEUTRAL_WORLD_MOTION_SCREEN_PASS"
        : baseEngineMode
          ? "BASE_ENGINE_PRESERVED_SCREEN_PASS"
          : "STRUCTURED_ACTIVE_SCREEN_PASS"
    : concreteMode
      ? "STRUCTURED_ACTIVE_DYAD_CONCRETE_BEATS_CONFIRMED"
      : neutralMode
        ? "STRUCTURED_ACTIVE_DYAD_NEUTRAL_WORLD_MOTION_CONFIRMED"
        : baseEngineMode
          ? "STRUCTURED_ACTIVE_DYAD_BASE_ENGINE_CONFIRMED"
          : "STRUCTURED_ACTIVE_DYAD_CONFIRMED";

  // Concrete NPC gate uses subplot heuristic as EXTERNAL_SUBPLOT proxy;
  // ext total as incidental voice budget (manual review refines in report).
  const npcOk = concreteMode
    ? screen
      ? vNpc === 0 && vExt <= 2
      : vNpc <= 1 && vExt <= 2
    : neutralMode
      ? screen
        ? npcCount === 0 && extTotal <= 1
        : npcCount <= 1 && extTotal <= 2
      : screen
        ? npcCount <= 1 && extTotal <= 1
        : npcCount <= 1 && extTotal <= 2;

  const lengthOk = concreteMode
    ? screen
      ? vAvgLen >= 3100 &&
        vLt2400 === 0 &&
        vTurn1Avg >= 2700 &&
        vTurn1Min >= 2400 &&
        vLengthDrop <= 0.12 &&
        vAvgCore >= BASELINE_CORE * 0.95
      : vAvgLen >= 3000 &&
        vLt2400 === 0 &&
        vLengthDrop <= 0.1 &&
        ge2700 >= 5 &&
        vTurn1Avg >= 2700 &&
        vAvgCore >= BASELINE_CORE * 0.95
    : neutralMode
      ? screen
        ? avgLen >= 3100 &&
          lt2400 === 0 &&
          turn1Avg >= 2700 &&
          turn1Lt2400 === 0 &&
          lengthDrop <= 0.12 &&
          avgCore >= BASELINE_CORE * 0.95
        : avgLen >= 3000 &&
          lt2400 === 0 &&
          lengthDrop <= 0.1 &&
          ge2700 >= 5 &&
          turn1Avg >= 2700 &&
          avgCore >= BASELINE_CORE * 0.95
      : avgLen >= 3000 &&
        lt2400 === 0 &&
        lengthDrop <= 0.1 &&
        avgCore >= BASELINE_CORE * 0.95 &&
        (screen ? turn1Avg >= 2700 && turn1Lt2400 === 0 : ge2700 >= 5 && turn1Avg >= 2700);

  const rhythmOk = concreteMode
    ? vResume <= 1.0 &&
      vFrag <= 1.35 &&
      vDlg >= 10 &&
      vDlg <= 18 &&
      vNarr >= 82 &&
      vNarr <= 90
    : neutralMode
      ? screen
        ? resume <= 1.0 &&
          frag <= 1.4 &&
          dlgPct >= 10 &&
          dlgPct <= 19 &&
          narrPct >= 81 &&
          narrPct <= 90
        : resume <= 1.0 &&
          frag <= 1.35 &&
          dlgPct >= 10 &&
          dlgPct <= 18 &&
          narrPct >= 82 &&
          narrPct <= 90
      : screen
        ? resume <= 1.1 &&
          frag <= 1.4 &&
          dlgPct >= 10 &&
          dlgPct <= 18 &&
          narrPct >= 82 &&
          narrPct <= 90
        : resume <= 1.0 &&
          frag <= 1.35 &&
          dlgPct >= 10 &&
          dlgPct <= 18 &&
          narrPct >= 82 &&
          narrPct <= 90;

  const reactionOk = concreteMode
    ? screen
      ? vReaction >= 3
      : vReaction >= 5
    : screen
      ? reaction >= 3
      : reaction >= 5;

  const runtimeOk = concreteMode
    ? vn >= EXPECTED_N && validRows.every((r) => r.retry === 0 && r.recovery === 0)
    : true;

  if (concreteMode && !runtimeOk) {
    verdict = "CONCRETE_BEAT_RUNTIME_INVALID";
  } else if (n < EXPECTED_N && !concreteMode) {
    verdict = "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  } else if (!npcOk) {
    verdict = screen
      ? concreteMode
        ? "CONCRETE_BEAT_NPC_FAIL"
        : neutralMode
          ? "NEUTRAL_WORLD_MOTION_NPC_FAIL"
          : baseEngineMode
            ? "BASE_ENGINE_PRESERVED_NPC_FAIL"
            : "STRUCTURED_ACTIVE_NPC_FAIL"
      : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  } else if (!lengthOk) {
    verdict = screen
      ? concreteMode
        ? "CONCRETE_BEAT_LENGTH_FAIL"
        : neutralMode
          ? "NEUTRAL_WORLD_MOTION_LENGTH_FAIL"
          : baseEngineMode
            ? "BASE_ENGINE_PRESERVED_LENGTH_FAIL"
            : "STRUCTURED_ACTIVE_LENGTH_FAIL"
      : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  } else if (!reactionOk) {
    verdict = screen
      ? concreteMode
        ? "CONCRETE_BEAT_REACTION_FAIL"
        : neutralMode
          ? "NEUTRAL_WORLD_MOTION_REACTION_FAIL"
          : "STRUCTURED_ACTIVE_REACTION_FAIL"
      : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  } else if (!rhythmOk) {
    verdict = screen
      ? concreteMode
        ? "CONCRETE_BEAT_RHYTHM_FAIL"
        : neutralMode
          ? "NEUTRAL_WORLD_MOTION_RHYTHM_FAIL"
          : baseEngineMode
            ? "BASE_ENGINE_PRESERVED_RHYTHM_FAIL"
            : "STRUCTURED_ACTIVE_RHYTHM_FAIL"
      : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  }

  const reportN = concreteMode ? vn : n;
  const reportNpc = concreteMode ? vNpc : npcCount;
  const reportExt = concreteMode ? vExt : extTotal;
  const reportAvgLen = concreteMode ? vAvgLen : avgLen;
  const reportAvgCore = concreteMode ? vAvgCore : avgCore;
  const reportTurn1Avg = concreteMode ? vTurn1Avg : turn1Avg;
  const reportTurn1Min = concreteMode ? vTurn1Min : Math.min(...turn1.map((r) => r.len), Infinity);
  const reportLt2400 = concreteMode ? vLt2400 : lt2400;
  const reportDrop = concreteMode ? vLengthDrop : lengthDrop;
  const reportResume = concreteMode ? vResume : resume;
  const reportFrag = concreteMode ? vFrag : frag;
  const reportDlg = concreteMode ? vDlg : dlgPct;
  const reportNarr = concreteMode ? vNarr : narrPct;
  const reportReaction = concreteMode ? vReaction : reaction;

  const out = {
    screen: SCREEN_LABEL,
    n: reportN,
    expected_n: EXPECTED_N,
    NPC: `${reportNpc}/${reportN}`,
    external_dialogue: reportExt,
    administrative_subplot: adminTotal,
    avg_length: reportAvgLen,
    avg_core: reportAvgCore,
    turn1_avg: reportTurn1Avg,
    turn1_min: Number.isFinite(reportTurn1Min) ? reportTurn1Min : 0,
    turn2_avg: turn2Avg,
    turn1_lt_2400: turn1Lt2400,
    count_lt_2400: reportLt2400,
    count_ge_2700: ge2700,
    length_drop: Math.round(reportDrop * 10000) / 10000,
    primary_resume_per_1000: reportResume,
    fragmentation: reportFrag,
    dialogue_share: Math.round(reportDlg * 10) / 10,
    narration_share: Math.round(reportNarr * 10) / 10,
    reaction: `${reportReaction}/${reportN}`,
    finish_stop: finishOk,
    retry_recovery_zero: retryOk,
    runtime_ok: runtimeOk,
    scene_focus_applied: `${focusApplied}/${n}`,
    npc_ok: npcOk,
    length_ok: lengthOk,
    reaction_ok: reactionOk,
    rhythm_ok: rhythmOk,
    verdict,
    rows,
  };

  const name =
    SCREEN_LABEL === "confirm" ? "CONFIRM_VERDICT.json" : "SCREEN_VERDICT.json";
  writeFileSync(join(ART_ROOT, name), JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        verdict,
        NPC: out.NPC,
        avg_length: reportAvgLen,
        turn1_avg: turn1Avg,
        turn2_avg: turn2Avg,
        avg_core: avgCore,
        reaction: out.reaction,
        resume,
        frag,
        dlg: out.dialogue_share,
        narr: out.narration_share,
        scene_focus_applied: out.scene_focus_applied,
      },
      null,
      2
    )
  );
}

if (!CANDIDATE_DIR || !existsSync(join(CANDIDATE_DIR, "all_runs.json"))) {
  console.error("CANDIDATE_DIR with all_runs.json required");
  process.exit(1);
}
main();
