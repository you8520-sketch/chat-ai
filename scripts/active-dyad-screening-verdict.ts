/**
 * Screening / confirmation gates for active_dyad_compact_* variants.
 *
 * Usage:
 *   SCREEN_LABEL=A CANDIDATE_DIR=... EXPECTED_N=4 node --import tsx scripts/active-dyad-screening-verdict.ts
 */
import fs from "node:fs";
import path from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const CANDIDATE_DIR = process.env.CANDIDATE_DIR || "";
const OUT =
  process.env.OUT_DIR || path.join(ART, "26-active-dyad");
const SCREEN_LABEL = process.env.SCREEN_LABEL || "A";
const EXPECTED_N = Number(process.env.EXPECTED_N || "4");
const BASELINE_AVG = 3532;

function loadRows(dir: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const run of [1, 2, 3, 4]) {
    for (const turn of [1, 2]) {
      const rawPath = path.join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      if (!fs.existsSync(rawPath)) continue;
      const raw = fs.readFileSync(rawPath, "utf8");
      const m = JSON.parse(
        fs.readFileSync(path.join(dir, `run${run}`, `turn${turn}-metrics.json`), "utf8")
      );
      const pipePath = path.join(dir, `run${run}`, `turn${turn}-pipeline.json`);
      const pipe = fs.existsSync(pipePath)
        ? JSON.parse(fs.readFileSync(pipePath, "utf8"))
        : null;
      const dm = computeDialogueMetrics({ text: raw, primaryCharacterName: "라이크" });
      const admin =
        /(데스크|창구|접수실|의무실|확인실).{0,40}(부르|안내|등록|검사|접수|호출)/.test(raw) ||
        /(직원이|안내원이|담당자가|경비(?:원)?(?:가|이)).{0,30}(말했|물었|부르|안내)/.test(raw);
      const reaction = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
        raw.slice(-320)
      );
      rows.push({
        id: `run${run}/turn${turn}`,
        len: m.provider_raw_ws,
        npc: Boolean(m.npc_subplot),
        ext: Number(m.external_dialogue_blocks || 0),
        admin: admin ? 1 : 0,
        resume_per_1000:
          (Number(m.manual_resume_transitions || 0) * 1000) /
          Math.max(1, Number(m.provider_raw_ws || 1)),
        frag: Number(m.manual_fragmentation_multiplier || 0),
        dlg: dm.dialogue_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        narr: dm.narration_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        reaction: reaction ? 1 : 0,
        finish: m.api?.finish_reason || "",
        retry: m.api?.retry_count || 0,
        recovery: m.api?.length_recovery_passes || 0,
        dyad_mode: pipe?.integrity?.activeDyadMode ?? null,
        dyad_applied: pipe?.integrity?.activeDyadApplied ?? null,
        order: pipe?.integrity?.promptInjectionOrder ?? null,
        variant: pipe?.integrity?.canaryVariant ?? null,
      });
    }
  }
  return rows;
}

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function main() {
  if (!CANDIDATE_DIR) throw new Error("CANDIDATE_DIR required");
  const rows = loadRows(CANDIDATE_DIR);
  if (rows.length !== EXPECTED_N) {
    throw new Error(`expected ${EXPECTED_N} outputs, got ${rows.length} in ${CANDIDATE_DIR}`);
  }

  const npc = rows.filter((r) => r.npc).length;
  const ext = rows.reduce((a, r) => a + Number(r.ext), 0);
  const admin = rows.reduce((a, r) => a + Number(r.admin), 0);
  const avgLen = avg(rows.map((r) => Number(r.len)));
  const lt2400 = rows.filter((r) => Number(r.len) < 2400).length;
  const ge2700 = rows.filter((r) => Number(r.len) >= 2700).length;
  const drop = (BASELINE_AVG - avgLen) / BASELINE_AVG;
  const resume = avg(rows.map((r) => Number(r.resume_per_1000)));
  const frag = avg(rows.map((r) => Number(r.frag)));
  const dlg = avg(rows.map((r) => Number(r.dlg)));
  const narr = avg(rows.map((r) => Number(r.narr)));
  const reaction = rows.reduce((a, r) => a + Number(r.reaction), 0);
  const finishOk = rows.every((r) => {
    const fr = String(r.finish).toLowerCase();
    return !fr || fr === "stop" || fr === "end_turn";
  });
  const retryOk =
    rows.reduce((a, r) => a + Number(r.retry) + Number(r.recovery), 0) === 0;

  const npcOk =
    EXPECTED_N === 4 ? npc <= 1 && ext <= 1 && admin === 0 : npc <= 1 && ext <= 2 && admin === 0;
  const lengthOk =
    EXPECTED_N === 4
      ? avgLen >= 3000 && lt2400 === 0 && drop <= 0.1
      : avgLen >= 3000 && lt2400 === 0 && ge2700 >= 5 && drop <= 0.1;
  const reactionNeed = EXPECTED_N === 4 ? 3 : 5;
  const reactionOk = reaction >= reactionNeed;
  const resumeOk = EXPECTED_N === 4 ? resume <= 1.1 : resume <= 1.0;
  const fragOk = EXPECTED_N === 4 ? frag <= 1.4 : frag <= 1.35;
  const shareOk =
    EXPECTED_N === 4
      ? dlg >= 0.1 && dlg <= 0.2 && narr >= 0.8 && narr <= 0.9
      : dlg >= 0.1 && dlg <= 0.18 && narr >= 0.82 && narr <= 0.9;

  let verdict: string;
  if (EXPECTED_N === 4) {
    if (!npcOk) verdict = `COMPACT_GATE_NPC_FAIL`;
    else if (!lengthOk) verdict = `COMPACT_GATE_LENGTH_FAIL`;
    else if (!reactionOk) verdict = `COMPACT_GATE_REACTION_FAIL`;
    else if (!resumeOk || !fragOk || !shareOk || !finishOk || !retryOk) {
      verdict = `COMPACT_GATE_LENGTH_FAIL`;
    } else {
      verdict =
        SCREEN_LABEL === "B"
          ? "EMBEDDED_GATE_SCREEN_PASS"
          : SCREEN_LABEL === "C"
            ? "INTERNAL_PROGRESSION_FALLBACK_CONFIRMED"
            : "COMPACT_GATE_SCREEN_PASS";
    }
    if (SCREEN_LABEL === "B") {
      // Position isolation labels when comparing to A externally
      if (verdict === "EMBEDDED_GATE_SCREEN_PASS") {
        /* keep */
      } else if (!npcOk) verdict = "COMPACT_GATE_NPC_FAIL";
      else if (!lengthOk || !reactionOk) {
        // caller interprets A-fail+B-fail vs A-fail+B-pass
        verdict = lengthOk ? "COMPACT_GATE_REACTION_FAIL" : "COMPACT_GATE_LENGTH_FAIL";
      }
    }
  } else {
    if (!npcOk) verdict = "ACTIVE_DYAD_NPC_INVALID";
    else if (!lengthOk) verdict = "ACTIVE_DYAD_LENGTH_INVALID";
    else if (!reactionOk || !resumeOk || !fragOk || !shareOk) verdict = "ACTIVE_DYAD_QUALITY_INVALID";
    else verdict = "ACTIVE_DYAD_CONFIRMED";
  }

  const report = {
    screen: SCREEN_LABEL,
    n: rows.length,
    NPC: `${npc}/${EXPECTED_N}`,
    external_dialogue: ext,
    administrative_subplot: admin,
    avg_length: Number(avgLen.toFixed(1)),
    count_lt_2400: lt2400,
    count_ge_2700: ge2700,
    length_drop: Number(drop.toFixed(4)),
    primary_resume_per_1000: Number(resume.toFixed(3)),
    fragmentation: Number(frag.toFixed(3)),
    dialogue_share: Number((dlg * 100).toFixed(1)),
    narration_share: Number((narr * 100).toFixed(1)),
    reaction: `${reaction}/${EXPECTED_N}`,
    finish_stop: finishOk,
    retry_recovery_zero: retryOk,
    npc_ok: npcOk,
    length_ok: lengthOk,
    reaction_ok: reactionOk,
    verdict,
    rows,
  };

  fs.mkdirSync(OUT, { recursive: true });
  const name =
    EXPECTED_N === 6
      ? "ACTIVE_CONFIRMATION_VERDICT.json"
      : `SCREEN_${SCREEN_LABEL}_VERDICT.json`;
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
