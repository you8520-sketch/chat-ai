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
    (screen || ge2700 >= 5);
  const rhythmOk = screen
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
  const reactionOk = screen ? reaction >= 3 : reaction >= 5;

  if (n < EXPECTED_N) verdict = "STRUCTURED_ACTIVE_CONFIRM_INVALID";
  else if (!npcOk)
    verdict = screen ? "STRUCTURED_ACTIVE_NPC_FAIL" : "STRUCTURED_ACTIVE_CONFIRM_INVALID";
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
        avg_length: avgLen,
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
