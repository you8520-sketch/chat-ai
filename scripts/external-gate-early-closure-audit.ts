/**
 * Offline early-closure audit: production baseline vs early_external_intervention_gate_system.
 * No new model calls — annotate tails of existing RAWs.
 *
 * Usage:
 *   node --import tsx scripts/external-gate-early-closure-audit.ts
 */
import fs from "node:fs";
import path from "node:path";

const ART =
  process.env.ART_ROOT ||
  "/opt/cursor/artifacts/deepseek-common-root-audit";
const BASELINE =
  process.env.BASELINE_DIR ||
  path.join(ART, "19-dialogue-resume/post_fix_production_baseline");
const GATE =
  process.env.GATE_DIR ||
  path.join(ART, "24-external-intervention-gate/early_external_intervention_gate_system");
const OUT =
  process.env.OUT_DIR || path.join(ART, "25-external-gate-regression");

type Beat =
  | "USER_CUE_RESPONSE"
  | "PRIMARY_OBSERVATION"
  | "PRIMARY_INTERPRETATION"
  | "PRIMARY_DECISION"
  | "PRIMARY_ACTION"
  | "PRIMARY_DIALOGUE"
  | "FUNCTIONAL_ENVIRONMENT"
  | "RELATIONSHIP_CHANGE"
  | "EXTERNAL_INTERVENTION"
  | "REACTION_OPENING"
  | "PREMATURE_CLOSURE"
  | "PASSIVE_WAIT"
  | "SUMMARY_OR_WRAPUP";

function charLen(s: string) {
  return [...s].length;
}

function tail(text: string, n = 700) {
  const chars = [...text.replace(/\r\n/g, "\n")];
  return chars.slice(Math.max(0, chars.length - n)).join("");
}

function splitParas(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogue(p: string) {
  return /[“"][^”"\n]{1,}[”"]/.test(p) || /^[“"]/.test(p.trim());
}

function classifyPara(p: string, idx: number, total: number, fullTail: string): Beat {
  const t = p.trim();
  const nearEnd = idx >= total - 2;

  if (
    /(일단\s*여기|이만|나중에|다음에|일단\s*가|이쯤|마무리|오늘은\s*여기|그만\s*하자)/.test(t) &&
    nearEnd
  ) {
    return "PREMATURE_CLOSURE";
  }
  if (
    nearEnd &&
    /(기다렸|기다려|말없이\s*서|가만히\s*서|그저\s*바라|반응을\s*기다|대답을\s*기다|침묵이\s*흘렀)/.test(
      t
    ) &&
    !/[?？]/.test(t)
  ) {
    return "PASSIVE_WAIT";
  }
  if (
    nearEnd &&
    /(결국|요약|정리하면|그렇게\s*해서|한동안|그걸로|상황은\s*이랬)/.test(t)
  ) {
    return "SUMMARY_OR_WRAPUP";
  }

  if (
    /(직원|안내원|담당자|경비|데스크|접수|등록\s*절차|신원\s*대조|호출|보안팀).{0,40}(말했|물었|부르|안내|다가)/.test(
      t
    ) ||
    (/(직원|안내원|담당|경비)/.test(t.slice(0, 60)) && isDialogue(t))
  ) {
    return "EXTERNAL_INTERVENTION";
  }

  if (isDialogue(t)) {
    if (/[?？]|어때|할래|갈래|뭐\s*해|골라|선택|믿어도|말해봐|괜찮|같이\s*가/.test(t)) {
      return "REACTION_OPENING";
    }
    return "PRIMARY_DIALOGUE";
  }

  if (
    /(손|어깨|소매|다가|물러|잡|끌|걸음|고개|시선|거리|앉|일어|돌아|이끌)/.test(t) &&
    /(다|는다|었다|였다|았다)\.?$/.test(t)
  ) {
    if (/(가까|신뢰|경계|편해|말투|호칭|약속|곁|옆에)/.test(t)) {
      return "RELATIONSHIP_CHANGE";
    }
    return "PRIMARY_ACTION";
  }

  if (/(판단|해석|생각|의심|망설|깨달|알아차|신경|불편|궁금|경계|느낌|기억)/.test(t)) {
    return "PRIMARY_INTERPRETATION";
  }
  if (/(정하|결정|고르|선택|하자|가야|앉자|가자|물어|확인하)/.test(t)) {
    return "PRIMARY_DECISION";
  }
  if (/(빛|소리|바람|발소리|군중|소음|공기|향|로비|창|무전|발걸음)/.test(t)) {
    return "FUNCTIONAL_ENVIRONMENT";
  }
  if (/(렌|그|그녀|소매|고개|말|행동|갸웃|두리번)/.test(t)) {
    return nearEnd && idx === 0 ? "USER_CUE_RESPONSE" : "PRIMARY_OBSERVATION";
  }
  if (idx === 0) return "USER_CUE_RESPONSE";
  return "PRIMARY_OBSERVATION";
}

const MEANINGFUL: Beat[] = [
  "PRIMARY_DECISION",
  "PRIMARY_ACTION",
  "RELATIONSHIP_CHANGE",
  "REACTION_OPENING",
  "PRIMARY_DIALOGUE",
  "FUNCTIONAL_ENVIRONMENT",
  "EXTERNAL_INTERVENTION",
  "PRIMARY_INTERPRETATION",
];

function annotate(raw: string, meta: { npc?: boolean; reaction?: number }) {
  const total_chars = charLen(raw);
  const t = tail(raw, 700);
  const paras = splitParas(t);
  const beats = paras.map((p, i) => {
    const beat = classifyPara(p, i, paras.length, t);
    return {
      beat,
      chars: charLen(p),
      preview: p.slice(0, 160).replace(/\n/g, " "),
    };
  });

  // Also scan full text for reaction opening at absolute end
  const endSlice = raw.slice(-320);
  const hasReactionOpening =
    /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
      endSlice
    );

  let lastMeaningfulIdx = -1;
  for (let i = beats.length - 1; i >= 0; i--) {
    if (MEANINGFUL.includes(beats[i]!.beat)) {
      lastMeaningfulIdx = i;
      break;
    }
  }

  // offset from start of full text approximated via tail
  const tailStart = Math.max(0, total_chars - 700);
  let offsetInTail = 0;
  for (let i = 0; i <= lastMeaningfulIdx; i++) {
    if (i < lastMeaningfulIdx) offsetInTail += beats[i]!.chars + 2;
  }
  const last_meaningful_change_offset =
    lastMeaningfulIdx >= 0 ? tailStart + offsetInTail : -1;
  const chars_after_last_meaningful_change =
    lastMeaningfulIdx >= 0
      ? beats.slice(lastMeaningfulIdx + 1).reduce((a, b) => a + b.chars, 0)
      : total_chars;

  const count = (b: Beat) => beats.filter((x) => x.beat === b).length;

  return {
    total_chars,
    core_scene_chars: total_chars, // early-closure focus; external already low on gate
    tail_chars: charLen(t),
    tail_text: t,
    beat_count: beats.length,
    beats,
    primary_decision_count: count("PRIMARY_DECISION"),
    primary_action_count: count("PRIMARY_ACTION"),
    relationship_change_count: count("RELATIONSHIP_CHANGE"),
    reaction_opening_count:
      count("REACTION_OPENING") + (hasReactionOpening && count("REACTION_OPENING") === 0 ? 1 : 0),
    premature_closure: count("PREMATURE_CLOSURE") > 0,
    passive_wait: count("PASSIVE_WAIT") > 0,
    summary_or_wrapup: count("SUMMARY_OR_WRAPUP") > 0,
    external_intervention_in_tail: count("EXTERNAL_INTERVENTION") > 0,
    last_meaningful_change_offset,
    chars_after_last_meaningful_change,
    has_reaction_opening_end: hasReactionOpening,
    harness_npc: meta.npc ?? null,
    harness_reaction: meta.reaction ?? null,
    focus_short: total_chars < 2400,
    focus_no_reaction: !hasReactionOpening,
  };
}

function load(dir: string, label: string) {
  const out = [];
  for (const run of [1, 2, 3]) {
    for (const turn of [1, 2]) {
      const rawPath = path.join(dir, `run${run}`, `turn${turn}-provider-raw.txt`);
      const metricsPath = path.join(dir, `run${run}`, `turn${turn}-metrics.json`);
      const raw = fs.readFileSync(rawPath, "utf8");
      const m = fs.existsSync(metricsPath)
        ? JSON.parse(fs.readFileSync(metricsPath, "utf8"))
        : {};
      const reaction = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
        raw.slice(-320)
      )
        ? 1
        : 0;
      out.push({
        id: `${label}/run${run}/turn${turn}`,
        label,
        run,
        turn,
        ...annotate(raw, { npc: m.npc_subplot, reaction }),
      });
    }
  }
  return out;
}

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const baseline = load(BASELINE, "baseline");
  const gate = load(GATE, "gate");
  const all = [...baseline, ...gate];

  const b = baseline;
  const g = gate;
  const short = g.filter((x) => x.focus_short);
  const noReact = g.filter((x) => x.focus_no_reaction);

  const summary = {
    baseline: {
      n: b.length,
      avg_total: avg(b.map((x) => x.total_chars)),
      avg_beat_count: avg(b.map((x) => x.beat_count)),
      avg_decision: avg(b.map((x) => x.primary_decision_count)),
      avg_action: avg(b.map((x) => x.primary_action_count)),
      avg_relationship: avg(b.map((x) => x.relationship_change_count)),
      avg_reaction_opening: avg(b.map((x) => x.reaction_opening_count)),
      premature_closure_rate: `${b.filter((x) => x.premature_closure).length}/${b.length}`,
      passive_wait_rate: `${b.filter((x) => x.passive_wait).length}/${b.length}`,
      reaction_end_rate: `${b.filter((x) => x.has_reaction_opening_end).length}/${b.length}`,
      avg_chars_after_last_meaningful: avg(b.map((x) => x.chars_after_last_meaningful_change)),
      external_in_tail: `${b.filter((x) => x.external_intervention_in_tail).length}/${b.length}`,
    },
    gate: {
      n: g.length,
      avg_total: avg(g.map((x) => x.total_chars)),
      avg_beat_count: avg(g.map((x) => x.beat_count)),
      avg_decision: avg(g.map((x) => x.primary_decision_count)),
      avg_action: avg(g.map((x) => x.primary_action_count)),
      avg_relationship: avg(g.map((x) => x.relationship_change_count)),
      avg_reaction_opening: avg(g.map((x) => x.reaction_opening_count)),
      premature_closure_rate: `${g.filter((x) => x.premature_closure).length}/${g.length}`,
      passive_wait_rate: `${g.filter((x) => x.passive_wait).length}/${g.length}`,
      reaction_end_rate: `${g.filter((x) => x.has_reaction_opening_end).length}/${g.length}`,
      avg_chars_after_last_meaningful: avg(g.map((x) => x.chars_after_last_meaningful_change)),
      external_in_tail: `${g.filter((x) => x.external_intervention_in_tail).length}/${g.length}`,
      short_outputs: short.map((x) => x.id),
      no_reaction_outputs: noReact.map((x) => x.id),
    },
  };

  // Verdict heuristics
  const gatePremature =
    g.filter((x) => x.premature_closure || x.passive_wait || x.summary_or_wrapup).length >= 3;
  const gateFewerBeats = summary.gate.avg_beat_count < summary.baseline.avg_beat_count * 0.85;
  const gateFewerReact =
    summary.gate.avg_reaction_opening < summary.baseline.avg_reaction_opening * 0.6;
  const gateLessExternal =
    g.filter((x) => x.external_intervention_in_tail).length <
    b.filter((x) => x.external_intervention_in_tail).length;
  const gateShorter = summary.gate.avg_total < summary.baseline.avg_total * 0.9;
  const replacementMissing =
    gateLessExternal &&
    summary.gate.avg_decision + summary.gate.avg_action + summary.gate.avg_relationship <
      summary.baseline.avg_decision +
        summary.baseline.avg_action +
        summary.baseline.avg_relationship;

  let verdict: string;
  let explanation: string;
  const flags: string[] = [];
  if (gatePremature && gateShorter) flags.push("GATE_CAUSES_PREMATURE_CLOSURE");
  if (replacementMissing && gateShorter) flags.push("GATE_REMOVES_EXTERNAL_BEATS_WITHOUT_REPLACEMENT");
  if (gateFewerReact) flags.push("GATE_SUPPRESSES_REACTION_OPENING");
  if (gateFewerBeats && gateShorter && !gatePremature) {
    flags.push("POSITION_OR_PRIORITY_INTERFERENCE_SUSPECTED");
  }

  if (flags.length === 0) {
    verdict = "MIXED_REGRESSION";
    explanation = "Length/reaction regression present but no single dominant early-closure pattern isolated.";
  } else if (flags.length === 1) {
    verdict = flags[0]!;
    explanation = `Dominant early-closure pattern: ${verdict}.`;
  } else {
    verdict = "MIXED_REGRESSION";
    explanation = `Multiple regression signals: ${flags.join(", ")}.`;
  }

  fs.writeFileSync(
    path.join(OUT, "TAIL_BEAT_ANNOTATION.json"),
    JSON.stringify(
      {
        method:
          "Last-700-char paragraph beat classifier; manual-reviewable previews; focus on gate short (<2400) and no-reaction tails",
        summary,
        outputs: all.map(({ tail_text, ...rest }) => ({
          ...rest,
          tail_text,
        })),
      },
      null,
      2
    )
  );

  const md = `# Baseline vs External Intervention Gate — Early Closure

## Averages

| metric | baseline | gate | delta |
|---|---:|---:|---:|
| total_chars | ${summary.baseline.avg_total.toFixed(1)} | ${summary.gate.avg_total.toFixed(1)} | ${(summary.gate.avg_total - summary.baseline.avg_total).toFixed(1)} |
| beat_count (tail) | ${summary.baseline.avg_beat_count.toFixed(2)} | ${summary.gate.avg_beat_count.toFixed(2)} | |
| primary_decision | ${summary.baseline.avg_decision.toFixed(2)} | ${summary.gate.avg_decision.toFixed(2)} | |
| primary_action | ${summary.baseline.avg_action.toFixed(2)} | ${summary.gate.avg_action.toFixed(2)} | |
| relationship_change | ${summary.baseline.avg_relationship.toFixed(2)} | ${summary.gate.avg_relationship.toFixed(2)} | |
| reaction_opening | ${summary.baseline.avg_reaction_opening.toFixed(2)} | ${summary.gate.avg_reaction_opening.toFixed(2)} | |
| reaction_end_rate | ${summary.baseline.reaction_end_rate} | ${summary.gate.reaction_end_rate} | |
| premature_closure | ${summary.baseline.premature_closure_rate} | ${summary.gate.premature_closure_rate} | |
| passive_wait | ${summary.baseline.passive_wait_rate} | ${summary.gate.passive_wait_rate} | |
| external_in_tail | ${summary.baseline.external_in_tail} | ${summary.gate.external_in_tail} | |
| chars_after_last_meaningful | ${summary.baseline.avg_chars_after_last_meaningful.toFixed(1)} | ${summary.gate.avg_chars_after_last_meaningful.toFixed(1)} | |

## Focus: gate short outputs (<2400)

${short
  .map(
    (x) =>
      `### ${x.id} (len=${x.total_chars})
- premature=${x.premature_closure} passive_wait=${x.passive_wait} summary=${x.summary_or_wrapup}
- decision=${x.primary_decision_count} action=${x.primary_action_count} rel=${x.relationship_change_count} reaction_open=${x.reaction_opening_count}
- chars_after_last_meaningful=${x.chars_after_last_meaningful_change}
- beats: ${x.beats.map((b) => b.beat).join(" → ")}
`
  )
  .join("\n")}

## Focus: gate no reaction-opening end

${noReact
  .map(
    (x) =>
      `- \`${x.id}\` len=${x.total_chars} premature=${x.premature_closure} passive=${x.passive_wait} last_beats=${x.beats
        .slice(-3)
        .map((b) => b.beat)
        .join("→")}`
  )
  .join("\n")}

## Verdict

\`${verdict}\`

${explanation}

Signals: ${flags.join(", ") || "(none dominant)"}
`;

  fs.writeFileSync(path.join(OUT, "BASELINE_VS_GATE.md"), md);

  const verdictObj = {
    early_closure_verdict: verdict,
    signals: flags,
    explanation,
    baseline_avg_length: Number(summary.baseline.avg_total.toFixed(1)),
    gate_avg_length: Number(summary.gate.avg_total.toFixed(1)),
    baseline_reaction_end: summary.baseline.reaction_end_rate,
    gate_reaction_end: summary.gate.reaction_end_rate,
    gate_short_ids: short.map((x) => x.id),
    gate_no_reaction_ids: noReact.map((x) => x.id),
    next: "active_dyad_compact_system (short state label; no multi-condition judgment block)",
    pr_235: "close without merge — superseded by ACTIVE_DYAD state-gate audit",
  };
  fs.writeFileSync(path.join(OUT, "VERDICT.json"), JSON.stringify(verdictObj, null, 2));
  console.log(JSON.stringify(verdictObj, null, 2));
  console.log(`wrote ${OUT}`);
}

main();
