/**
 * Active Interaction Suite gate for early_external_intervention_gate_system.
 *
 * Usage:
 *   node --import tsx scripts/external-intervention-gate-verdict.ts
 */
import fs from "node:fs";
import path from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const CANDIDATE_DIR =
  process.env.CANDIDATE_DIR ||
  path.join(ART, "24-external-intervention-gate/early_external_intervention_gate_system");
const BASELINE_DIR =
  process.env.BASELINE_DIR ||
  path.join(ART, "19-dialogue-resume/post_fix_production_baseline");
const OUT =
  process.env.OUT_DIR || path.join(ART, "24-external-intervention-gate");

const STAFF_ATTR =
  /(직원|스태프|간호사|의사|안내원|담당자|의료진|회색\s*셔츠|접수\s*담당|연구원|동료|행인|경비|데스크|창구|조태형\s*씨)/;
const ADMIN_Q =
  /(신원\s*대조|바이탈|임시\s*등록|기본\s*확인부터|안쪽으로\s*안내|등록\s*정보|다음\s*분|번호\s*부르)/;
const ADMIN_NARR =
  /(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실|확인실|호출|행정|검문|출입\s*절차|데스크\s*너머|창구\s*앞)/;

function charLen(s: string) {
  return [...s].length;
}

function npcClassify(text: string) {
  const staff: string[] = [];
  for (const m of text.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
    const q = m[1]!;
    const before = text.slice(Math.max(0, m.index! - 140), m.index!);
    if (STAFF_ATTR.test(before.replace(/\n/g, " ")) || ADMIN_Q.test(q)) {
      staff.push(q);
    }
  }
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let adminParas = 0;
  for (const p of paras) {
    if (ADMIN_NARR.test(p) && (STAFF_ATTR.test(p) || /(직원|데스크|창구|접수|담당|의무실|대기)/.test(p))) {
      adminParas += 1;
    }
  }
  // Background crowd mention only (no speech) — not counted as subplot
  const backgroundMention = /(사람들|군중|인파|행인들|붐볐)/.test(text) && staff.length === 0;
  const externalDialogueBlocks = staff.length;
  const administrativeSubplot = adminParas > 0 && (staff.length > 0 || adminParas >= 2);
  const npcSubplot =
    staff.length >= 2 ||
    administrativeSubplot ||
    (staff.length >= 1 && adminParas >= 1);
  return {
    external_dialogue_blocks: externalDialogueBlocks,
    administrative_subplot: administrativeSubplot ? 1 : 0,
    background_npc_mention: backgroundMention ? 1 : 0,
    new_speaking_npc_count: staff.length,
    npc_subplot: npcSubplot,
  };
}

function coreScene(text: string) {
  // Approximate: total − external dialogue chars − admin narr chars
  let externalChars = 0;
  for (const m of text.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
    const q = m[1]!;
    const before = text.slice(Math.max(0, m.index! - 140), m.index!);
    if (STAFF_ATTR.test(before.replace(/\n/g, " ")) || ADMIN_Q.test(q)) {
      externalChars += charLen(m[0]);
    }
  }
  for (const p of text.split(/\n\s*\n/)) {
    if (ADMIN_NARR.test(p) && STAFF_ATTR.test(p)) {
      // subtract only the non-quote portion roughly once
      const withoutQuotes = p.replace(/[“"][^”"\n]+[”"]/g, "");
      externalChars += charLen(withoutQuotes);
    }
  }
  const total = charLen(text);
  return { total_chars: total, core_scene_chars: Math.max(0, total - externalChars), external_subplot_chars: externalChars };
}

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function loadRows(dir: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const run of [1, 2, 3]) {
    for (const turn of [1, 2]) {
      const rawPath = path.join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      const metricsPath = path.join(dir, `run${run}`, `turn${turn}-metrics.json`);
      const pipePath = path.join(dir, `run${run}`, `turn${turn}-pipeline.json`);
      if (!fs.existsSync(rawPath)) continue;
      const raw = fs.readFileSync(rawPath, "utf8");
      const metrics = fs.existsSync(metricsPath)
        ? JSON.parse(fs.readFileSync(metricsPath, "utf8"))
        : {};
      const pipe = fs.existsSync(pipePath)
        ? JSON.parse(fs.readFileSync(pipePath, "utf8"))
        : null;
      const dm = computeDialogueMetrics({ text: raw, primaryCharacterName: "라이크" });
      const npc = npcClassify(raw);
      const core = coreScene(raw);
      const reaction = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
        raw.slice(-320)
      );
      rows.push({
        id: `run${run}/turn${turn}`,
        ...core,
        ...npc,
        primary_dialogue_blocks: Math.max(0, dm.quote_pair_count - npc.external_dialogue_blocks),
        primary_resume: dm.manual_resume_transitions,
        primary_resume_per_1000_core:
          core.core_scene_chars > 0
            ? (dm.manual_resume_transitions * 1000) / core.core_scene_chars
            : 0,
        fragmentation: dm.manual_fragmentation_multiplier,
        dialogue_char_share:
          dm.dialogue_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        narration_char_share:
          dm.narration_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        reaction_point: reaction ? 1 : 0,
        finish_reason: metrics?.api?.finish_reason ?? "",
        retry_count: metrics?.api?.retry_count ?? 0,
        recovery: metrics?.api?.length_recovery_passes ?? 0,
        harness_npc: metrics?.npc_subplot ?? null,
        harness_external_blocks: metrics?.external_dialogue_blocks ?? null,
        gate_applied: pipe?.integrity?.externalInterventionGateApplied ?? null,
        prompt_order: pipe?.integrity?.promptInjectionOrder ?? null,
        canary_variant: pipe?.integrity?.canaryVariant ?? null,
      });
    }
  }
  return rows;
}

function main() {
  const candidate = loadRows(CANDIDATE_DIR);
  const baseline = loadRows(BASELINE_DIR);
  if (candidate.length !== 6) {
    throw new Error(`expected 6 candidate outputs, got ${candidate.length}`);
  }

  const cTotal = avg(candidate.map((r) => Number(r.total_chars)));
  const bTotal = avg(baseline.map((r) => Number(r.total_chars)));
  const cCore = avg(candidate.map((r) => Number(r.core_scene_chars)));
  const npcCount = candidate.filter((r) => r.npc_subplot || r.harness_npc).length;
  const extBlocks = candidate.reduce(
    (a, r) => a + Number(r.harness_external_blocks ?? r.external_dialogue_blocks),
    0
  );
  const adminCount = candidate.reduce((a, r) => a + Number(r.administrative_subplot), 0);
  const lt2400 = candidate.filter((r) => Number(r.total_chars) < 2400).length;
  const ge2700 = candidate.filter((r) => Number(r.total_chars) >= 2700).length;
  const lengthDrop = bTotal > 0 ? (bTotal - cTotal) / bTotal : 0;
  const cResume = avg(candidate.map((r) => Number(r.primary_resume_per_1000_core)));
  const bResume = avg(baseline.map((r) => Number(r.primary_resume_per_1000_core)));
  const cFrag = avg(candidate.map((r) => Number(r.fragmentation)));
  const bFrag = avg(baseline.map((r) => Number(r.fragmentation)));
  const dlg = avg(candidate.map((r) => Number(r.dialogue_char_share)));
  const narr = avg(candidate.map((r) => Number(r.narration_char_share)));
  const reaction = candidate.reduce((a, r) => a + Number(r.reaction_point), 0);
  const finishOk = candidate.every((r) => {
    const fr = String(r.finish_reason).toLowerCase();
    return !fr || fr === "stop" || fr === "end_turn";
  });
  const retryRec =
    candidate.reduce((a, r) => a + Number(r.retry_count) + Number(r.recovery), 0) === 0;

  const failures: string[] = [];
  if (npcCount > 1 || extBlocks > 2) failures.push("NPC_REDUCTION_INSUFFICIENT");
  if (adminCount > 0) failures.push("NPC_REDUCTION_INSUFFICIENT_ADMIN");
  if (cTotal < 3000 || lt2400 > 0 || ge2700 < 5 || lengthDrop > 0.1) {
    failures.push("CORE_SCENE_LENGTH_INVALID_TOTAL");
  }
  if (cCore < 3043) failures.push("CORE_SCENE_LENGTH_INVALID");
  if (cResume > bResume * 1.1 + 1e-9 || cFrag > bFrag * 1.1 + 1e-9) {
    failures.push("DIALOGUE_RHYTHM_REGRESSION");
  }
  if (dlg < 0.1 || dlg > 0.2 || narr < 0.8 || narr > 0.9) {
    failures.push("DIALOGUE_RHYTHM_REGRESSION_SHARE");
  }
  if (reaction < 5) failures.push("REACTION_POINT_REGRESSION");
  if (!finishOk || !retryRec) failures.push("QUALITY_REGRESSION_FINISH_RETRY");

  let active_verdict = "SYSTEM_EXTERNAL_GATE_ACTIVE_PASS";
  if (failures.some((f) => f.startsWith("NPC_REDUCTION"))) {
    active_verdict = "NPC_REDUCTION_INSUFFICIENT";
  } else if (failures.some((f) => f.startsWith("CORE_SCENE"))) {
    active_verdict = "CORE_SCENE_LENGTH_INVALID";
  } else if (failures.some((f) => f.startsWith("DIALOGUE_RHYTHM"))) {
    active_verdict = "DIALOGUE_RHYTHM_REGRESSION";
  } else if (failures.some((f) => f.startsWith("REACTION"))) {
    active_verdict = "REACTION_POINT_REGRESSION";
  } else if (failures.length) {
    active_verdict = "CORE_SCENE_LENGTH_INVALID";
  }

  const report = {
    n: candidate.length,
    npc_subplot: `${npcCount}/6`,
    external_dialogue_blocks_total: extBlocks,
    administrative_subplot_total: adminCount,
    avg_total_length: Number(cTotal.toFixed(1)),
    avg_core_scene_length: Number(cCore.toFixed(1)),
    baseline_avg_total: Number(bTotal.toFixed(1)),
    total_length_drop_ratio: Number(lengthDrop.toFixed(4)),
    count_lt_2400: lt2400,
    count_ge_2700: ge2700,
    primary_resume_per_1000_core: Number(cResume.toFixed(3)),
    baseline_primary_resume_per_1000_core: Number(bResume.toFixed(3)),
    fragmentation: Number(cFrag.toFixed(3)),
    baseline_fragmentation: Number(bFrag.toFixed(3)),
    dialogue_share: Number((dlg * 100).toFixed(1)),
    narration_share: Number((narr * 100).toFixed(1)),
    reaction_point: `${reaction}/6`,
    finish_stop: finishOk,
    retry_recovery_zero: retryRec,
    failures,
    active_verdict,
    rows: candidate,
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "ACTIVE_SUITE_VERDICT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
