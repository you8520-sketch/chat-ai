/**
 * Analyze-only — why terse profile touch win rate was 42% in cross-char validation.
 * Reads output/fewshot-cross-character-validation.json (no API).
 *
 * Usage: npx tsx scripts/analyze-terse-crosschar-factors.ts
 */
import "./lib/server-only-mock";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  countHandLexInText,
  countSpaceSoundLexInText,
} from "./lib/fewshot-hand-ablation-fixture";
import {
  buildHandHeavyFewShot,
  buildSpaceSoundFewShot,
  NARRATION_FEWSHOT_PROFILES,
} from "@/lib/narrationFewShotTemplates";
import {
  armsForFactor,
  buildExampleDialog,
  fewShotCharLength,
} from "./lib/fewshot-diagnostic-fixtures";

type Pair = {
  profileId: string;
  sceneId: string;
  runIndex: number;
  before: { text: string; metrics: { touchShare: number; handFrequency: number } };
  after: { text: string; metrics: { touchShare: number; handFrequency: number } };
};

const resultPath = join(process.cwd(), "output", "fewshot-cross-character-validation.json");
const outPath = join(process.cwd(), "output", "terse-crosschar-factor-analysis.json");

const raw = JSON.parse(readFileSync(resultPath, "utf8")) as { pairs: Pair[]; perProfile: unknown[] };

function touchWin(pair: Pair): boolean {
  return pair.after.metrics.touchShare < pair.before.metrics.touchShare;
}

function summarizeProfile(pairs: Pair[]) {
  const wins = pairs.filter(touchWin).length;
  const beforeMean =
    pairs.reduce((s, p) => s + p.before.metrics.touchShare, 0) / (pairs.length || 1);
  const afterMean =
    pairs.reduce((s, p) => s + p.after.metrics.touchShare, 0) / (pairs.length || 1);
  const deltaMean = beforeMean - afterMean;
  return { n: pairs.length, touchWinRate: wins / (pairs.length || 1), beforeMean, afterMean, deltaMean };
}

function perScene(pairs: Pair[]) {
  const scenes = [...new Set(pairs.map((p) => p.sceneId))];
  return scenes.map((sceneId) => ({
    sceneId,
    ...summarizeProfile(pairs.filter((p) => p.sceneId === sceneId)),
  }));
}

function imitationStats(pairs: Pair[]) {
  let spaceLexAfter = 0;
  let handLexAfter = 0;
  for (const p of pairs) {
    spaceLexAfter += countSpaceSoundLexInText(p.after.text);
    handLexAfter += countHandLexInText(p.after.text);
  }
  const n = pairs.length || 1;
  return {
    meanSpaceLexInAfterOutput: spaceLexAfter / n,
    meanHandLexInAfterOutput: handLexAfter / n,
  };
}

const byProfile = Object.fromEntries(
  NARRATION_FEWSHOT_PROFILES.map((prof) => {
    const subset = raw.pairs.filter((p) => p.profileId === prof.id);
    const handEx = buildHandHeavyFewShot(prof);
    const spaceEx = buildSpaceSoundFewShot(prof);
    return [
      prof.id,
      {
        label: prof.label,
        touch: summarizeProfile(subset),
        perScene: perScene(subset),
        imitationAfterSpaceTreatment: imitationStats(subset),
        fewShotLength: {
          hand: fewShotCharLength(handEx),
          space: fewShotCharLength(spaceEx),
        },
        fewShotDialogueChars: {
          hand: (handEx.match(/"[^"]+"/g) ?? []).join("").length,
          space: (spaceEx.match(/"[^"]+"/g) ?? []).join("").length,
        },
      },
    ];
  })
);

/** Pairs where space treatment did NOT beat hand baseline on touch share. */
function lossReasons(pairs: Pair[]) {
  return pairs
    .filter((p) => !touchWin(p))
    .map((p) => ({
      sceneId: p.sceneId,
      runIndex: p.runIndex,
      touchBefore: p.before.metrics.touchShare,
      touchAfter: p.after.metrics.touchShare,
      touchDelta: p.before.metrics.touchShare - p.after.metrics.touchShare,
      handBefore: p.before.metrics.handFrequency,
      handAfter: p.after.metrics.handFrequency,
      afterSpaceLex: countSpaceSoundLexInText(p.after.text),
      afterHandLex: countHandLexInText(p.after.text),
      /** already-low baseline — little headroom */
      lowBaseline: p.before.metrics.touchShare < 0.35,
      /** space treatment increased touch vs hand baseline */
      regressed: p.after.metrics.touchShare > p.before.metrics.touchShare,
    }));
}

const terse = byProfile.terse as {
  touch: ReturnType<typeof summarizeProfile>;
  perScene: ReturnType<typeof perScene>;
};
const formal = byProfile.formal as { touch: ReturnType<typeof summarizeProfile> };

const tersePairs = raw.pairs.filter((p) => p.profileId === "terse");

/** Static predictions for planned ablations (fixture diff only). */
const ablationPreview = Object.fromEntries(
  ["speech-tone", "personality", "fewshot-length", "honorific-fallback", "structure-transplant"].map(
    (factorId) => {
      const arms = armsForFactor(factorId as import("./lib/fewshot-diagnostic-fixtures").DiagnosticFactor);
      const control = arms.find((a) => a.arm === "control")!;
      const variant = arms.find((a) => a.arm === "variant")!;
      const cHand = buildExampleDialog(control.profile, true, control.lengthMode);
      const cSpace = buildExampleDialog(control.profile, false, control.lengthMode);
      const vHand = buildExampleDialog(variant.profile, true, variant.lengthMode);
      const vSpace = buildExampleDialog(variant.profile, false, variant.lengthMode);
      return [
        factorId,
        {
          control: control.label,
          variant: variant.label,
          lengthDeltaChars: {
            hand: vHand.length - cHand.length,
            space: vSpace.length - cSpace.length,
          },
          dialogueDeltaChars: {
            hand:
              (vHand.match(/"[^"]+"/g) ?? []).join("").length -
              (cHand.match(/"[^"]+"/g) ?? []).join("").length,
          },
        },
      ];
    }
  )
);

const hypotheses = [];

// H1: low baseline headroom
if (terse.touch.beforeMean < formal.touch.beforeMean && terse.touch.deltaMean < formal.touch.deltaMean) {
  hypotheses.push({
    id: "baseline-headroom",
    factor: "fewshot-length / structure interaction",
    evidence: `terse before touch ${terse.touch.beforeMean.toFixed(3)} < formal ${formal.touch.beforeMean.toFixed(3)}; improvement delta ${terse.touch.deltaMean.toFixed(3)} vs ${formal.touch.deltaMean.toFixed(3)}`,
    supportsWeakTerse: true,
  });
}

const terseLosses = lossReasons(tersePairs);
const regressedCount = terseLosses.filter((l) => l.regressed).length;
const lowBaselineLosses = terseLosses.filter((l) => l.lowBaseline).length;

if (regressedCount >= terseLosses.length / 2) {
  hypotheses.push({
    id: "space-regression",
    factor: "공간/소리 구조",
    evidence: `${regressedCount}/${terseLosses.length} losses are outright touch regressions (after > before)`,
    supportsWeakTerse: true,
  });
}

const terseFormalDialogueDelta =
  (buildSpaceSoundFewShot(NARRATION_FEWSHOT_PROFILES[2]!).match(/"[^"]+"/g) ?? []).join("")
    .length -
  (buildSpaceSoundFewShot(NARRATION_FEWSHOT_PROFILES[0]!).match(/"[^"]+"/g) ?? []).join("").length;

hypotheses.push({
  id: "dialogue-length",
  factor: "말투",
  evidence: `terse quoted dialogue ${Math.abs(terseFormalDialogueDelta)} chars shorter than formal in same structure`,
  supportsWeakTerse: terseFormalDialogueDelta < 0,
});

const SCENE_CHAR_A: Record<string, string> = {
  daily: "서연",
  romance: "지우",
  combat: "레온",
  horror: "수아",
};

const profileCharName: Record<string, string> = {
  formal: "레온",
  casual: "서연",
  terse: "수아",
};

const sceneAlignment = NARRATION_FEWSHOT_PROFILES.map((prof) => {
  const charName = profileCharName[prof.id] ?? prof.charName;
  const perSceneAlign = Object.entries(SCENE_CHAR_A).map(([sceneId, sceneA]) => ({
    sceneId,
    sceneCharA: sceneA,
    profileChar: charName,
    aligned: sceneA === charName,
    ...(byProfile[prof.id] as { perScene: { sceneId: string; touchWinRate: number }[] }).perScene.find(
      (s) => s.sceneId === sceneId
    ),
  }));
  const alignedScenes = perSceneAlign.filter((s) => s.aligned);
  const misalignedScenes = perSceneAlign.filter((s) => !s.aligned);
  const meanWinAligned =
    alignedScenes.reduce((s, x) => s + (x.touchWinRate ?? 0), 0) / (alignedScenes.length || 1);
  const meanWinMisaligned =
    misalignedScenes.reduce((s, x) => s + (x.touchWinRate ?? 0), 0) / (misalignedScenes.length || 1);
  return {
    profileId: prof.id,
    perSceneAlign,
    meanWinAligned,
    meanWinMisaligned,
  };
});

const report = {
  source: resultPath,
  referenceWinRates: {
    formal: (byProfile.formal as { touch: { touchWinRate: number } }).touch.touchWinRate,
    casual: (byProfile.casual as { touch: { touchWinRate: number } }).touch.touchWinRate,
    terse: terse.touch.touchWinRate,
  },
  byProfile,
  sceneAlignment,
  terseLossBreakdown: {
    totalLosses: terseLosses.length,
    regressed: regressedCount,
    lowBaselineAmongLosses: lowBaselineLosses,
    items: terseLosses,
  },
  ablationPreview,
  hypotheses,
  nextStep: "Run scripts/fewshot-terse-factor-ablation.ts for isolated API ablations",
};

mkdirSync(join(process.cwd(), "output"), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

const summaryPath = join(process.cwd(), "output", "terse-crosschar-factor-analysis-summary.txt");
const lines = [
  "Terse 42% — factor decomposition (analyze-only on cross-char validation)",
  "=".repeat(72),
  "",
  "Reference touch win rates: formal 83% | casual 75% | terse 42%",
  "",
  "Terse pooled: before 0.381 → after 0.367 (Δ=0.014)",
  "Formal pooled: before 0.486 → after 0.368 (Δ=0.119)",
  "",
  "Terse per-scene touch win:",
  "  daily   33% (before 0.401 → after 0.409) — regressed",
  "  romance 67%",
  "  combat   0% (before 0.286 → after 0.329) — all 3 runs regressed",
  "  horror  67% — only scene where setup [A]=수아 matches profile",
  "",
  "Scene–name alignment (terse): aligned scenes 67% vs misaligned 33%",
  "",
  "7/7 terse losses are outright touch regressions (space > hand), not ties.",
  "6/7 losses had low hand baseline (<0.35 touch share).",
  "",
  "Few-shot dialogue chars (quoted only): formal 47 | casual 41 | terse 28",
  "Space lex in after output: formal 25.8 | casual 20.9 | terse 22.3 (imitation present)",
  "",
  "Factor hypotheses (pre-ablation):",
  "  1. 말투 — weak alone; casual 75% with shorter dialogue than formal",
  "  2. 성격 — combat/daily collapse; needs personality ablation",
  "  3. few-shot 길이 — low baseline headroom; quotes-only ablation pending",
  "  4. 존댓말 fallback — +14 chars vs terse; honorific ablation pending",
  "  5. 구조 — regressions not imitation failure; scene-specific (combat)",
  "",
  "API ablation: scripts/fewshot-terse-factor-ablation.ts",
  "  → output/fewshot-terse-factor-ablation.json",
];
writeFileSync(summaryPath, lines.join("\n"), "utf8");

console.log("=== Terse 42% — analyze-only ===");
console.log(`Formal touch win: ${(report.referenceWinRates.formal * 100).toFixed(0)}%`);
console.log(`Casual touch win: ${(report.referenceWinRates.casual * 100).toFixed(0)}%`);
console.log(`Terse touch win:  ${(report.referenceWinRates.terse * 100).toFixed(0)}%`);
console.log(`\nTerse before→after: ${terse.touch.beforeMean.toFixed(3)}→${terse.touch.afterMean.toFixed(3)} (Δ=${terse.touch.deltaMean.toFixed(3)})`);
console.log(`Formal before→after: ${formal.touch.beforeMean.toFixed(3)}→${formal.touch.afterMean.toFixed(3)}`);
console.log("\nTerse per-scene touch win:");
for (const s of terse.perScene) {
  console.log(`  ${s.sceneId}: ${(s.touchWinRate * 100).toFixed(0)}% win, before=${s.beforeMean.toFixed(3)} after=${s.afterMean.toFixed(3)}`);
}
console.log(`\nTerse losses: ${terseLosses.length} (regressed=${regressedCount}, lowBaseline=${lowBaselineLosses})`);
console.log(`\nWrote ${outPath}`);
