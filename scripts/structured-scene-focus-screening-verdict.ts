/**
 * Active screening / confirmation verdict for structured_scene_focus_active_dyad.
 *
 * Env: CANDIDATE_DIR, EXPECTED_N (4|6), SCREEN_LABEL (screen|confirm), ART_ROOT
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
  core?: number;
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
  decision_action?: number;
  interpretation?: number;
  relationship?: number;
  environment?: number;
  filler?: number;
  sceneFocusState?: string | null;
  sceneFocusApplied?: boolean;
  diagnostics?: unknown;
};

function loadAllRuns(dir: string): any {
  return JSON.parse(readFileSync(join(dir, "all_runs.json"), "utf8"));
}

function extractRows(all: any): Row[] {
  const rows: Row[] = [];
  const runs = all.runs ?? all;
  for (const run of runs) {
    const runId = run.run ?? run.id ?? rows.length + 1;
    const turns = run.turns ?? [];
    for (const turn of turns) {
      const t = turn.turn ?? turn.id;
      const metrics = turn.metrics ?? {};
      const dlg = metrics.dialogue_metrics ?? metrics;
      const review = turn.manual_semantic ?? turn.semantic ?? {};
      const integrity = turn.integrity ?? turn.pipeline?.integrity ?? {};
      const raw =
        turn.provider_raw ??
        turn.provider_raw_merged ??
        turn.db_saved ??
        "";
      const len =
        metrics.provider_raw_ws ??
        metrics.canonical_length_ws ??
        (typeof raw === "string" ? raw.replace(/\s+/g, "").length : 0);
      const core =
        review.core_scene_chars ??
        metrics.core_scene_chars ??
        Math.round(len * 0.95);
      rows.push({
        id: `run${runId}/turn${t}`,
        len,
        core,
        npc: Boolean(review.npc_subplot ?? review.new_speaking_npc ?? false),
        ext: Number(review.external_dialogue_blocks ?? 0),
        admin: Number(review.administrative_subplot ?? 0),
        resume_per_1000: Number(
          dlg.primary_resume_per_1000_core ??
            dlg.primary_resume_per_1000 ??
            dlg.resume_per_1000 ??
            0
        ),
        frag: Number(dlg.primary_fragmentation ?? dlg.fragmentation ?? 0),
        dlg: Number(dlg.dialogue_share ?? dlg.dialogue_ratio ?? 0),
        narr: Number(dlg.narration_share ?? dlg.narration_ratio ?? 0),
        reaction: Number(review.reaction_point ?? 0),
        finish: String(turn.api?.finish_reason ?? turn.finish_reason ?? "stop"),
        retry: Number(turn.api?.retry_count ?? 0),
        recovery: Number(turn.api?.length_recovery_passes ?? 0),
        decision_action: Number(review.primary_decision_action ?? 0),
        interpretation: Number(review.specific_interpretation ?? 0),
        relationship: Number(review.relationship_movement ?? 0),
        environment: Number(review.functional_environment ?? 0),
        filler: Number(review.decorative_filler ?? 0),
        sceneFocusState: integrity.sceneFocusState ?? null,
        sceneFocusApplied: integrity.sceneFocusApplied ?? false,
        diagnostics: integrity.sceneFocusDiagnostics ?? null,
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
  const all = loadAllRuns(CANDIDATE_DIR);
  const rows = extractRows(all);
  const n = rows.length;

  const npcCount = rows.filter((r) => r.npc).length;
  const extTotal = rows.reduce((a, r) => a + r.ext, 0);
  const adminTotal = rows.reduce((a, r) => a + r.admin, 0);
  const avgLen = avg(rows.map((r) => r.len));
  const avgCore = avg(rows.map((r) => r.core ?? r.len));
  const lt2400 = rows.filter((r) => r.len < 2400).length;
  const ge2700 = rows.filter((r) => r.len >= 2700).length;
  const lengthDrop = (BASELINE_AVG - avgLen) / BASELINE_AVG;
  const resume = avg(rows.map((r) => r.resume_per_1000));
  const frag = avg(rows.map((r) => r.frag));
  const dlgShare = avg(rows.map((r) => r.dlg * (r.dlg > 1 ? 1 : 100)));
  const narrShare = avg(rows.map((r) => r.narr * (r.narr > 1 ? 1 : 100)));
  // normalize: if dlg already 0-1, convert to %
  const dlgPct = rows[0] && rows[0].dlg <= 1 ? avg(rows.map((r) => r.dlg * 100)) : dlgShare;
  const narrPct = rows[0] && rows[0].narr <= 1 ? avg(rows.map((r) => r.narr * 100)) : narrShare;
  const reaction = rows.filter((r) => r.reaction > 0).length;
  const finishOk = rows.every((r) => !r.finish || r.finish === "stop" || r.finish === "end_turn");
  const retryOk = rows.every((r) => r.retry === 0 && r.recovery === 0);

  const screen = EXPECTED_N <= 4;
  let verdict = screen
    ? "STRUCTURED_ACTIVE_SCREEN_PASS"
    : "STRUCTURED_ACTIVE_DYAD_CONFIRMED";

  const npcOk = screen ? npcCount <= 1 && extTotal <= 1 : npcCount <= 1 && extTotal <= 2;
  const lengthOk =
    avgLen >= 3000 &&
    lt2400 === 0 &&
    lengthDrop <= 0.1 &&
    avgCore >= BASELINE_CORE * 0.95 &&
    (!screen ? ge2700 >= 5 : true);
  const rhythmOk = screen
    ? resume <= 1.1 && frag <= 1.4 && dlgPct >= 10 && dlgPct <= 18 && narrPct >= 82 && narrPct <= 90
    : resume <= 1.0 && frag <= 1.35 && dlgPct >= 10 && dlgPct <= 18 && narrPct >= 82 && narrPct <= 90;
  const reactionOk = screen ? reaction >= 3 : reaction >= 5;

  if (!npcOk) verdict = screen ? "STRUCTURED_ACTIVE_NPC_FAIL" : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  else if (!lengthOk)
    verdict = screen ? "STRUCTURED_ACTIVE_LENGTH_FAIL" : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  else if (!reactionOk)
    verdict = screen ? "STRUCTURED_ACTIVE_REACTION_FAIL" : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  else if (!rhythmOk)
    verdict = screen ? "STRUCTURED_ACTIVE_RHYTHM_FAIL" : "STRUCTURED_ACTIVE_CONFIRM_INVALID";

  const out = {
    screen: SCREEN_LABEL,
    n,
    expected_n: EXPECTED_N,
    NPC: `${npcCount}/${n}`,
    external_dialogue: extTotal,
    administrative_subplot: adminTotal,
    avg_length: avgLen,
    avg_core: avgCore,
    count_lt_2400: lt2400,
    count_ge_2700: ge2700,
    length_drop: Math.round(lengthDrop * 10000) / 10000,
    primary_resume_per_1000: resume,
    fragmentation: frag,
    dialogue_share: Math.round(dlgPct * 10) / 10,
    narration_share: Math.round(narrPct * 10) / 10,
    reaction: `${reaction}/${n}`,
    finish_stop: finishOk,
    retry_recovery_zero: retryOk,
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
  console.log(JSON.stringify({ verdict, NPC: out.NPC, avg_length: avgLen, reaction: out.reaction }, null, 2));
}

if (!CANDIDATE_DIR || !existsSync(join(CANDIDATE_DIR, "all_runs.json"))) {
  console.error("CANDIDATE_DIR with all_runs.json required");
  process.exit(1);
}
main();
