/**
 * Step 3-4 — Style mechanism extraction (structure only, no nouns, no new sentences)
 *
 * Usage: npx tsx scripts/extract-style-mechanisms.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { collectStyleAuditSamples } from "./lib/collect-style-audit-samples";
import {
  aggregateStructural,
  analyzeStructuralRhythm,
} from "./lib/structural-rhythm-metrics";
import {
  MICRO_TURN_FLOW,
  PROMPT_INJECTION_FEASIBILITY,
  SCENE_MODE_OVERLAYS,
  STYLE_MECHANISMS,
  UNIVERSAL_FLOW_NOTATION,
} from "./lib/style-mechanism-patterns";

const OUT_JSON = join(process.cwd(), "output", "step34-style-mechanism-extraction.json");
const OUT_MD = join(process.cwd(), "output", "step34-style-mechanism-extraction.md");

function formatMechanism(m: (typeof STYLE_MECHANISMS)[number]): string[] {
  const flowStr = m.flow.map((e) => `${e.from} → ${e.to}${e.condition ? ` (${e.condition})` : ""}`).join("\n  ");
  const lenStr = Object.entries(m.lengthByPhase)
    .map(([p, l]) => `${p}:${l}`)
    .join(", ");
  return [
    `### ${m.id} — ${m.title}`,
    "",
    "**Triggers (structure)**",
    ...m.triggers.map((t) => `- ${t}`),
    "",
    "**Flow**",
    "```",
    flowStr || "(see MICRO_TURN_FLOW)",
    "```",
    lenStr ? `**Length regime:** ${lenStr}` : "",
    "",
    `**Prompt surface:** ${m.promptSurface.join(", ")}`,
    "",
  ].filter(Boolean);
}

function main() {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  const { samples } = collectStyleAuditSamples({ target: 60 });
  const structural = samples.map((s) => analyzeStructuralRhythm(s.text));
  const agg = aggregateStructural(structural);

  const productionGap = {
    M01_shortWhenTension: agg.lengthEndCompressRate,
    M02_longAtOpen: agg.lengthFrontHeavyMean,
    M03_withholdProxy: agg.contrastPerTurn,
    M04_indirectEmotion: agg.emotionLabelInNarration,
    M05_alternation: agg.alternation,
    M06_maxNarBlocks: agg.maxConsecutiveNarration,
    M08_tensionModeShare: (agg.modeDistribution.tension + agg.modeDistribution.combat) / agg.sampleCount,
    M09_calmModeShare: agg.modeDistribution.calm / agg.sampleCount,
    M10_hookAtEnd: agg.hookAtEndRate,
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    noContentNouns: true,
    noNewSentences: true,
    microTurnFlow: MICRO_TURN_FLOW,
    universalFlowNotation: UNIVERSAL_FLOW_NOTATION,
    sceneModeOverlays: SCENE_MODE_OVERLAYS,
    mechanisms: STYLE_MECHANISMS,
    productionStructuralBaseline: agg,
    productionGapSignals: productionGap,
    promptInjectionFeasibility: PROMPT_INJECTION_FEASIBILITY,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const mechBody = STYLE_MECHANISMS.flatMap(formatMechanism).join("\n");

  const feasibilityTable = PROMPT_INJECTION_FEASIBILITY.map(
    (r) =>
      `| ${r.surface} | ${r.currentState} | ${r.canInduceMechanism} | ${r.mechanismIds.join(", ")} | ${r.designNote} |`
  ).join("\n");

  const md = [
    "# Step 3-4 — Style Mechanism Extraction",
    "",
    "**원칙:** 문장·감각 명사 없음. 패턴·흐름·리듬만. prod 미적용.",
    "",
    "---",
    "",
    "## Universal flow (모델이 따라 할 리듬)",
    "",
    "```",
    UNIVERSAL_FLOW_NOTATION,
    "```",
    "",
    "### Micro-turn phase graph",
    "",
    ...MICRO_TURN_FLOW.map((e) => `- ${e.from} → ${e.to}${e.condition ? ` _(${e.condition})_` : ""}`),
    "",
    "### Scene-mode overlays (장르별 few-shot 분기 없음 — 파라미터만)",
    "",
    "| Mode | maxNar without dlg | dominant length | withhold cycle | hook type |",
    "|------|-------------------|-----------------|----------------|-----------|",
    `| calm | ${SCENE_MODE_OVERLAYS.calm.maxNarWithoutDlg} | ${SCENE_MODE_OVERLAYS.calm.dominantLength} | ${SCENE_MODE_OVERLAYS.calm.withholdCycle} | ${SCENE_MODE_OVERLAYS.calm.hookType} |`,
    `| tension | ${SCENE_MODE_OVERLAYS.tension.maxNarWithoutDlg} | ${SCENE_MODE_OVERLAYS.tension.dominantLength} | ${SCENE_MODE_OVERLAYS.tension.withholdCycle} | ${SCENE_MODE_OVERLAYS.tension.hookType} |`,
    `| combat | ${SCENE_MODE_OVERLAYS.combat.maxNarWithoutDlg} | ${SCENE_MODE_OVERLAYS.combat.dominantLength} | ${SCENE_MODE_OVERLAYS.combat.withholdCycle} | ${SCENE_MODE_OVERLAYS.combat.hookType} |`,
    "",
    "Genre → mode mapping은 `[genre_tone]` 1줄로만 (calm/tension/combat overlay 선택).",
    "",
    "---",
    "",
    "## 10 Mechanisms (structure only)",
    "",
    mechBody,
    "",
    "---",
    "",
    "## Production structural baseline (60 samples, noun-free metrics)",
    "",
    "| Signal | Observed | Target mechanism |",
    "|--------|----------|------------------|",
    `| end-of-turn length compress | ${(agg.lengthEndCompressRate * 100).toFixed(0)}% turns | M01 |`,
    `| short/mid/long mix | ${(agg.shortRatio * 100).toFixed(0)}/${(agg.midRatio * 100).toFixed(0)}/${(agg.longRatio * 100).toFixed(0)}% | M01/M02 |`,
    `| length stdDev | ${agg.lengthStdDev} | M01 |`,
    `| contrast (withhold proxy) / turn | ${agg.contrastPerTurn} | M03 |`,
    `| emotion label in narration / turn | ${agg.emotionLabelInNarration} | M04 |`,
    `| alternation | ${agg.alternation} | M05/M08 |`,
    `| max consecutive narration | ${agg.maxConsecutiveNarration} | M06/M08 |`,
    `| hook at turn end | ${(agg.hookAtEndRate * 100).toFixed(0)}% | M05/M10 |`,
    `| mode: calm/tension/combat/mixed | ${agg.modeDistribution.calm}/${agg.modeDistribution.tension}/${agg.modeDistribution.combat}/${agg.modeDistribution.mixed} | M08–M10 |`,
    "",
    "**Gap:** maxNar ${agg.maxConsecutiveNarration} >> overlay tension(2) — LENGTH가 wall path; mechanism induce 필요.",
    "",
    "---",
    "",
    "## Production Prompt — mechanism 유도 가능성 (design)",
    "",
    "| Surface | Current | Can induce? | Mechanisms | Design |",
    "|---------|---------|-------------|------------|--------|",
    feasibilityTable,
    "",
    "### Recommended injection shape (no example sentences)",
    "",
    "1. **`[예시 대화]` → `[BEAT FLOW]`** — UNIVERSAL_FLOW_NOTATION only; charName+4 replies remain speech-only",
    "2. **`[PROSE STYLE]` → `[RHYTHM REGIME]`** — phase→length table + scene_mode pointer; drop [SENSATION][EMOTION] bullets",
    "3. **`[DIALOGUE & NARRATION]`** — maxNarWithoutDlg + alternation period (numbers from overlay)",
    "4. **`[LENGTH CONTROL]`** — expand by beat-loop count, not narration stack",
    "5. **`[genre_tone]`** — selects calm|tension|combat overlay only",
    "",
    "### Explicitly NOT doing",
    "",
    "- Reference 문장 추가",
    "- 감각 명사 pool / rotate slot",
    "- Hand/touch/wall 감점 규칙 추가",
    "",
    "---",
    "",
    `JSON: \`output/step34-style-mechanism-extraction.json\``,
  ].join("\n");

  writeFileSync(OUT_MD, md, "utf8");
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main();
