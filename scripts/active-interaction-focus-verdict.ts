/**
 * Active Interaction Suite gate for early_active_interaction_focus.
 *
 * Usage:
 *   node --import tsx scripts/active-interaction-focus-verdict.ts
 *
 * Env:
 *   CANDIDATE_DIR  (default: .../22-active-interaction-focus/early_active_interaction_focus)
 *   BASELINE_DIR   (default: .../19-dialogue-resume/post_fix_production_baseline)
 *   OUT_DIR
 */
import fs from "node:fs";
import path from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const CANDIDATE_DIR =
  process.env.CANDIDATE_DIR ||
  path.join(ART, "22-active-interaction-focus/early_active_interaction_focus");
const BASELINE_DIR =
  process.env.BASELINE_DIR ||
  path.join(ART, "19-dialogue-resume/post_fix_production_baseline");
const CORE_BASELINE =
  process.env.CORE_BASELINE_JSON ||
  path.join(ART, "21-npc-length-decomposition/VERDICT.json");
const OUT =
  process.env.OUT_DIR ||
  path.join(ART, "22-active-interaction-focus");

type SpanKind =
  | "PRIMARY_DIALOGUE"
  | "PRIMARY_NARRATION"
  | "USER_REACTION_CONTEXT"
  | "EXTERNAL_DIALOGUE"
  | "EXTERNAL_SUBPLOT_NARRATION"
  | "FUNCTIONAL_ENVIRONMENT"
  | "DECORATIVE_FILLER";

const STAFF_ATTR =
  /(직원|스태프|간호사|의사|안내원|담당자|의료진|회색\s*셔츠|접수\s*담당|연구원|동료|행인|경비|데스크|창구|조태형\s*씨)/;
const ADMIN_Q =
  /(신원\s*대조|바이탈|임시\s*등록|기본\s*확인부터|안쪽으로\s*안내|등록\s*정보|다음\s*분|번호\s*부르)/;
const ADMIN_NARR =
  /(등록|접수|문진|차트|진료|신원|바이탈|서류|보호\s*대상|대기실|확인실|호출|행정|검문|출입\s*절차|데스크\s*너머|창구\s*앞)/;

function charLen(s: string) {
  return [...s].length;
}

function isExternalQuote(quote: string, before: string) {
  return STAFF_ATTR.test(before.replace(/\n/g, " ")) || ADMIN_Q.test(quote);
}

function classifyNarration(seg: string): SpanKind {
  const t = seg.trim();
  if (!t) return "PRIMARY_NARRATION";
  if (ADMIN_NARR.test(t) && (STAFF_ATTR.test(t) || /(직원|데스크|창구|접수|담당|의무실|대기)/.test(t))) {
    return "EXTERNAL_SUBPLOT_NARRATION";
  }
  if (/입꼬리|짧게\s*웃|작게\s*웃|살짝\s*고개/.test(t) && t.length < 90) {
    return "DECORATIVE_FILLER";
  }
  if (/(?:렌|소매|옆에|따른|바라본)/.test(t) && /손|시선|반응|말|고개/.test(t)) {
    return "USER_REACTION_CONTEXT";
  }
  if (
    /(?:빛|소리|바람|발소리|군중|소음|공기)/.test(t) &&
    !/(?:라이크는|태형은|그는|그가)/.test(t.slice(0, 36))
  ) {
    return "FUNCTIONAL_ENVIRONMENT";
  }
  return "PRIMARY_NARRATION";
}

function decompose(raw: string) {
  const text = raw.replace(/\r\n/g, "\n");
  const kinds: SpanKind[] = [];
  const quoteRe = /[“"]([^”"\n]+)[”"]/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  let primaryDlg = 0;
  let externalDlg = 0;
  let byKind: Record<SpanKind, number> = {
    PRIMARY_DIALOGUE: 0,
    PRIMARY_NARRATION: 0,
    USER_REACTION_CONTEXT: 0,
    EXTERNAL_DIALOGUE: 0,
    EXTERNAL_SUBPLOT_NARRATION: 0,
    FUNCTIONAL_ENVIRONMENT: 0,
    DECORATIVE_FILLER: 0,
  };
  const seq: SpanKind[] = [];
  while ((m = quoteRe.exec(text)) !== null) {
    if (m.index > cursor) {
      const narr = text.slice(cursor, m.index);
      const k = narr.trim() ? classifyNarration(narr) : "PRIMARY_NARRATION";
      byKind[k] += charLen(narr);
      seq.push(k);
    }
    const quote = m[1]!;
    const before = text.slice(Math.max(0, m.index - 140), m.index);
    const k: SpanKind = isExternalQuote(quote, before)
      ? "EXTERNAL_DIALOGUE"
      : "PRIMARY_DIALOGUE";
    byKind[k] += charLen(m[0]);
    seq.push(k);
    if (k === "PRIMARY_DIALOGUE") primaryDlg += 1;
    else externalDlg += 1;
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    const narr = text.slice(cursor);
    const k = narr.trim() ? classifyNarration(narr) : "PRIMARY_NARRATION";
    byKind[k] += charLen(narr);
    seq.push(k);
  }
  const total = charLen(text);
  const classified = Object.values(byKind).reduce((a, b) => a + b, 0);
  byKind.PRIMARY_NARRATION += Math.max(0, total - classified);
  const core =
    byKind.PRIMARY_DIALOGUE +
    byKind.PRIMARY_NARRATION +
    byKind.USER_REACTION_CONTEXT +
    byKind.FUNCTIONAL_ENVIRONMENT;
  const external =
    byKind.EXTERNAL_DIALOGUE + byKind.EXTERNAL_SUBPLOT_NARRATION;

  function resume(of: SpanKind[]) {
    let starts = 0;
    let last = false;
    for (const k of seq) {
      const d = of.includes(k);
      if (d && !last) starts += 1;
      last = d;
    }
    return Math.max(0, starts - 1);
  }

  return {
    total_chars: total,
    core_scene_chars: core,
    external_subplot_chars: external,
    primary_dialogue_blocks: primaryDlg,
    external_dialogue_blocks: externalDlg,
    primary_resume: resume(["PRIMARY_DIALOGUE"]),
    external_resume: resume(["EXTERNAL_DIALOGUE"]),
    all_speaker_resume: resume(["PRIMARY_DIALOGUE", "EXTERNAL_DIALOGUE"]),
    primary_resume_per_1000_core:
      core > 0 ? (resume(["PRIMARY_DIALOGUE"]) * 1000) / core : 0,
    npc_subplot: externalDlg >= 2 || byKind.EXTERNAL_SUBPLOT_NARRATION > 120,
  };
}

function qualityCounts(raw: string) {
  const paras = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let functional_action = 0;
  let specific_psychology = 0;
  let functional_environment = 0;
  let relationship_change = 0;
  let decorative_filler = 0;
  for (const p of paras) {
    if (/(손|어깨|걸음|다가|물러|잡|끌|밀어|고개|시선|소매|거리)/.test(p) && /(다|는다|었다|였다)\.?$/.test(p)) {
      functional_action += 1;
    }
    if (/(판단|해석|생각|의심|망설|깨달|알아차|신경|불편|궁금|경계)/.test(p)) {
      specific_psychology += 1;
    }
    if (/(소리|빛|공기|군중|발소리|바람|소음|향)/.test(p)) {
      functional_environment += 1;
    }
    if (/(가까|거리|신뢰|경계가|말투|호칭|관계|편해|낯설)/.test(p)) {
      relationship_change += 1;
    }
    if (/입꼬리|짧게 웃|작게 웃|살짝 고개/.test(p) && p.length < 80) {
      decorative_filler += 1;
    }
  }
  return {
    functional_action_count: functional_action,
    specific_psychology_count: specific_psychology,
    functional_environment_count: functional_environment,
    relationship_change_count: relationship_change,
    decorative_filler_count: decorative_filler,
  };
}

function loadRows(dir: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const run of [1, 2, 3]) {
    for (const turn of [1, 2]) {
      const rawPath = path.join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      const metricsPath = path.join(dir, `run${run}`, `turn${turn}-metrics.json`);
      if (!fs.existsSync(rawPath)) continue;
      const raw = fs.readFileSync(rawPath, "utf8");
      const metrics = fs.existsSync(metricsPath)
        ? JSON.parse(fs.readFileSync(metricsPath, "utf8"))
        : {};
      const dm = computeDialogueMetrics({ text: raw, primaryCharacterName: "라이크" });
      const span = decompose(raw);
      const q = qualityCounts(raw);
      const reaction =
        /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
          raw.slice(-320)
        );
      rows.push({
        id: `run${run}/turn${turn}`,
        ...span,
        ...q,
        dialogue_char_share: dm.dialogue_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        narration_char_share: dm.narration_chars / Math.max(1, dm.dialogue_chars + dm.narration_chars),
        fragmentation: dm.manual_fragmentation_multiplier,
        manual_resume_all: dm.manual_resume_transitions,
        reaction_point: reaction ? 1 : 0,
        finish_reason: metrics?.api?.finish_reason ?? metrics?.api?.finishReason ?? "",
        retry_count: metrics?.api?.retry_count ?? 0,
        recovery: metrics?.api?.length_recovery_passes ?? 0,
        harness_npc: metrics?.npc_subplot ?? null,
        harness_external_blocks: metrics?.external_dialogue_blocks ?? null,
      });
    }
  }
  return rows;
}

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function main() {
  const candidate = loadRows(CANDIDATE_DIR);
  const baseline = loadRows(BASELINE_DIR);
  if (candidate.length !== 6) {
    throw new Error(`expected 6 candidate outputs, got ${candidate.length} in ${CANDIDATE_DIR}`);
  }
  const coreBaseline = fs.existsSync(CORE_BASELINE)
    ? JSON.parse(fs.readFileSync(CORE_BASELINE, "utf8"))
    : null;

  const cTotal = avg(candidate.map((r) => Number(r.total_chars)));
  const bTotal = avg(baseline.map((r) => Number(r.total_chars)));
  const cCore = avg(candidate.map((r) => Number(r.core_scene_chars)));
  const bCore =
    coreBaseline?.baseline_core_scene_length ??
    avg(baseline.map((r) => Number(r.core_scene_chars)));
  const npcCount = candidate.filter((r) => r.npc_subplot || r.harness_npc).length;
  const extBlocks = candidate.reduce(
    (a, r) => a + Number(r.harness_external_blocks ?? r.external_dialogue_blocks),
    0
  );
  const lt2400 = candidate.filter((r) => Number(r.total_chars) < 2400).length;
  const ge2700 = candidate.filter((r) => Number(r.total_chars) >= 2700).length;
  const lengthDrop = bTotal > 0 ? (bTotal - cTotal) / bTotal : 0;
  const coreRatio = cCore / Math.max(1, bCore);
  const cResumePer1000 = avg(candidate.map((r) => Number(r.primary_resume_per_1000_core)));
  const bResumePer1000 = avg(baseline.map((r) => Number(r.primary_resume_per_1000_core)));
  const cFrag = avg(candidate.map((r) => Number(r.fragmentation)));
  const bFrag = avg(baseline.map((r) => Number(r.fragmentation)));
  const dlgShare = avg(candidate.map((r) => Number(r.dialogue_char_share)));
  const narrShare = avg(candidate.map((r) => Number(r.narration_char_share)));
  const reaction = candidate.reduce((a, r) => a + Number(r.reaction_point), 0);
  const finishOk = candidate.every((r) => {
    const fr = String(r.finish_reason).toLowerCase();
    return !fr || fr === "stop" || fr === "end_turn";
  });
  const retryRec =
    candidate.reduce((a, r) => a + Number(r.retry_count) + Number(r.recovery), 0) === 0;

  const failures: string[] = [];
  if (npcCount > 1) failures.push("NPC_REDUCTION_INSUFFICIENT");
  if (extBlocks > 2) failures.push("NPC_REDUCTION_INSUFFICIENT_EXT_BLOCKS");
  if (cTotal < 3000 || lt2400 > 0 || ge2700 < 5 || lengthDrop > 0.1) {
    failures.push("CORE_SCENE_LENGTH_INVALID_TOTAL");
  }
  if (coreRatio < 0.95) failures.push("CORE_SCENE_LENGTH_INVALID");
  if (cResumePer1000 > bResumePer1000 + 1e-9) failures.push("QUALITY_REGRESSION_RESUME");
  if (cFrag > bFrag * 1.1 + 1e-9) failures.push("QUALITY_REGRESSION_FRAG");
  if (dlgShare < 0.1 || dlgShare > 0.22) failures.push("QUALITY_REGRESSION_DIALOGUE_BAND");
  if (narrShare < 0.78 || narrShare > 0.9) failures.push("QUALITY_REGRESSION_NARRATION_BAND");
  if (reaction < 5) failures.push("QUALITY_REGRESSION_REACTION");
  if (!finishOk || !retryRec) failures.push("QUALITY_REGRESSION_FINISH_RETRY");

  let active_verdict = "ACTIVE_INTERACTION_FOCUS_PASS";
  if (failures.some((f) => f.startsWith("NPC_REDUCTION"))) {
    active_verdict = "NPC_REDUCTION_INSUFFICIENT";
  } else if (failures.some((f) => f.startsWith("CORE_SCENE"))) {
    active_verdict = "CORE_SCENE_LENGTH_INVALID";
  } else if (failures.length) {
    active_verdict = "QUALITY_REGRESSION";
  }

  const report = {
    n: candidate.length,
    npc_subplot: `${npcCount}/6`,
    external_speaker_blocks_total: extBlocks,
    avg_total_length: Number(cTotal.toFixed(1)),
    avg_core_scene_length: Number(cCore.toFixed(1)),
    baseline_avg_total: Number(bTotal.toFixed(1)),
    baseline_avg_core_scene: Number(Number(bCore).toFixed(1)),
    total_length_drop_ratio: Number(lengthDrop.toFixed(4)),
    core_scene_ratio_vs_baseline: Number(coreRatio.toFixed(4)),
    count_lt_2400: lt2400,
    count_ge_2700: ge2700,
    primary_resume_per_1000_core: Number(cResumePer1000.toFixed(3)),
    baseline_primary_resume_per_1000_core: Number(bResumePer1000.toFixed(3)),
    fragmentation: Number(cFrag.toFixed(3)),
    baseline_fragmentation: Number(bFrag.toFixed(3)),
    dialogue_share: Number((dlgShare * 100).toFixed(1)),
    narration_share: Number((narrShare * 100).toFixed(1)),
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
