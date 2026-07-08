import "./lib/server-only-mock";

/**
 * Few-shot ablation — hand-heavy vs space/sound/distance exampleDialog.
 *
 * Hypothesis: models imitate few-shot narration anchors more than PROSE rules.
 *
 * 4 scenes × 5 runs × Before/After = 20 pairs (40 API)
 *
 * Usage:
 *   npx tsx scripts/fewshot-hand-ablation-validation.ts --dry-run
 *   npx tsx scripts/fewshot-hand-ablation-validation.ts --fresh --runs=5
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { PROSE_VARIATION_SCENES } from "./lib/prose-variation-metrics";
import {
  HAND_TOUCH_METRIC_DEFS,
  analyzeHandTouchAudit,
  handTouchMetricValue,
  type HandTouchAuditMetrics,
} from "./lib/hand-touch-audit-metrics";
import {
  buildFewShotValidationChunks,
  fewShotExampleDialog,
  proseSceneToFewShotScene,
  countHandLexInText,
  countSpaceSoundLexInText,
  FEWSHOT_HAND_BASELINE,
  FEWSHOT_SPACE_TREATMENT,
  type FewShotVariant,
} from "./lib/fewshot-hand-ablation-fixture";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";
import { improvementDelta, isAfterBetter } from "./lib/prose-variation-metrics";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TEMPERATURE = 0.85;
const DEFAULT_RUNS = 5;

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  version: "before" | "after";
  text: string;
  metrics: HandTouchAuditMetrics;
};

type PairRecord = {
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: SampleRecord;
  after: SampleRecord;
};

type Checkpoint = {
  model: string;
  temperature: number;
  runsPerScene: number;
  pairs: PairRecord[];
};

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

function pairKey(sceneId: string, runIndex: number): string {
  return `${sceneId}#${runIndex}`;
}

async function generateSample(
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion,
  model: string,
  system: string,
  userContent: string
): Promise<string> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system,
        history: [{ role: "user", content: userContent }],
        model,
        temperature: TEMPERATURE,
        maxTokens: 4096,
        requestKind: "fewshot-hand-ablation-validation",
      });
      const text = res.text.trim();
      if (text.length >= 200) return text;
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error("Completion too short after retries");
}

function buildReports(pairs: PairRecord[]): PairedMetricReport[] {
  return HAND_TOUCH_METRIC_DEFS.map((def) => {
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;

    for (const pair of pairs) {
      const b = handTouchMetricValue(pair.before.metrics, def.key);
      const a = handTouchMetricValue(pair.after.metrics, def.key);
      beforeValues.push(b);
      afterValues.push(a);
      const imp = improvementDelta(b, a, def.higherIsBetter);
      improvements.push(imp);
      if (b === a) ties++;
      else if (isAfterBetter(b, a, def.higherIsBetter)) wins++;
    }

    return buildPairedMetricReport({
      metricKey: def.key,
      label: def.label,
      higherIsBetter: def.higherIsBetter,
      beforeValues,
      afterValues,
      improvements,
      wins,
      ties,
    });
  });
}

function evaluateFewShotAblation(reports: PairedMetricReport[]): {
  keep: boolean;
  reason: string;
  improvedSig: number;
  worseSig: number;
} {
  const improvedSig = reports.filter((r) => r.significantAt95 && r.verdict === "improved");
  const worseSig = reports.filter((r) => r.significantAt95 && r.verdict === "worse");

  if (worseSig.length > 0) {
    return {
      keep: false,
      reason: `Regression: ${worseSig.map((r) => r.label).join(", ")}`,
      improvedSig: improvedSig.length,
      worseSig: worseSig.length,
    };
  }

  if (improvedSig.length >= 1) {
    return {
      keep: true,
      reason: `Hypothesis supported: ${improvedSig.map((r) => r.label).join(", ")} improved`,
      improvedSig: improvedSig.length,
      worseSig: 0,
    };
  }

  const handReport = reports.find((r) => r.metricKey === "handFrequency");
  const gestureReport = reports.find((r) => r.metricKey === "gestureRepeatScore");
  const handBetter =
    handReport && handReport.improvement.mean > 0 && handReport.winRate >= 0.55;
  const gestureBetter =
    gestureReport && gestureReport.improvement.mean > 0 && gestureReport.winRate >= 0.55;

  if (handBetter && gestureBetter) {
    return {
      keep: true,
      reason: "Directional: hand frequency + gestureRepeatScore both improved (winRate≥55%)",
      improvedSig: 0,
      worseSig: 0,
    };
  }

  return {
    keep: false,
    reason: "Hypothesis not confirmed — inconclusive or flat",
    improvedSig: 0,
    worseSig: 0,
  };
}

async function main() {
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const dryRun = process.argv.includes("--dry-run");
  const runsPerScene = parseRunsArg();
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "fewshot-hand-ablation-checkpoint.json");
  const resultPath = join(outDir, "fewshot-hand-ablation-validation.json");

  writeFileSync(join(outDir, "fewshot-hand-baseline-example.txt"), FEWSHOT_HAND_BASELINE, "utf8");
  writeFileSync(join(outDir, "fewshot-space-treatment-example.txt"), FEWSHOT_SPACE_TREATMENT, "utf8");

  const { buildContext } = await import("@/services/contextBuilder");
  const personaDisplayName = "렌";
  const userPersona = formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대. 호기심 많음.");
  const userNote = formatUserNoteForPrompt("오래 알고 지낸 지인.");
  const memoryMeta = formatMemoryMetaForPrompt(
    parseMemoryMeta(JSON.stringify({ affection: 60, trust: 55, relationshipLabel: "지인" }))
  );
  const longTermMemory = "최근 도심에서 이상한 그림자를 목격했다.";

  function systemForVariant(variant: FewShotVariant, sceneId: string): string {
    const proseScene = PROSE_VARIATION_SCENES.find((s) => s.id === sceneId)!;
    const scene = proseSceneToFewShotScene(proseScene);
    return buildContext({
      charName: "카일",
      personaDisplayName,
      userNickname: personaDisplayName,
      chunks: buildFewShotValidationChunks(fewShotExampleDialog(variant)),
      userPersona,
      userNote,
      longTermMemory,
      memoryMeta,
      shortTermHistory: scene.shortTermHistory,
      currentUserMessage: scene.currentUserMessage,
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 6,
      genres: scene.genres,
      provider: "openrouter",
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    }).systemPrompt;
  }

  const baselineSystemLen = systemForVariant("hand-baseline", "daily").length;
  const treatmentSystemLen = systemForVariant("space-treatment", "daily").length;

  const totalPairs = PROSE_VARIATION_SCENES.length * runsPerScene;
  const totalApiCalls = totalPairs * 2;

  console.log("=== Few-shot Hand vs Space Ablation ===");
  console.log("Production buildContext | MOVEMENT A PROSE included");
  console.log(`Scenes: ${PROSE_VARIATION_SCENES.length} | Runs: ${runsPerScene} | API: ${totalApiCalls}`);
  console.log(`\nBaseline exampleDialog hand-lex: ${countHandLexInText(FEWSHOT_HAND_BASELINE)}`);
  console.log(`Treatment exampleDialog hand-lex: ${countHandLexInText(FEWSHOT_SPACE_TREATMENT)}`);
  console.log(`Baseline space/sound-lex: ${countSpaceSoundLexInText(FEWSHOT_HAND_BASELINE)}`);
  console.log(`Treatment space/sound-lex: ${countSpaceSoundLexInText(FEWSHOT_SPACE_TREATMENT)}`);
  console.log(`System prompt len: ${baselineSystemLen} → ${treatmentSystemLen} (Δ${treatmentSystemLen - baselineSystemLen})`);

  if (dryRun) {
    console.log("\n--dry-run: skipping API");
    return;
  }

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("\nCleared checkpoint (--fresh)");
  }

  let checkpoint: Checkpoint;

  if (analyzeOnly) {
    if (!existsSync(checkpointPath)) {
      console.error("No checkpoint");
      process.exit(1);
    }
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
  } else {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY required");
      process.exit(1);
    }
    const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
    const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

    const existing = fresh
      ? null
      : (JSON.parse(
          existsSync(checkpointPath) ? readFileSync(checkpointPath, "utf8") : "null"
        ) as Checkpoint | null);

    checkpoint = {
      model,
      temperature: TEMPERATURE,
      runsPerScene,
      pairs: existing?.pairs ?? [],
    };

    const doneKeys = new Set(checkpoint.pairs.map((p) => pairKey(p.sceneId, p.runIndex)));
    let completed = doneKeys.size;

    for (const scene of PROSE_VARIATION_SCENES) {
      const userContent = `${scene.setup}\n\n${scene.user}`;
      const systemBefore = systemForVariant("hand-baseline", scene.id);
      const systemAfter = systemForVariant("space-treatment", scene.id);

      for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (doneKeys.has(key)) continue;

        console.log(
          `[${++completed}/${totalPairs}] ${scene.label} run ${runIndex + 1}/${runsPerScene} | API ${completed * 2 - 1}-${completed * 2}/${totalApiCalls}`
        );

        const beforeText = await generateSample(callOpenRouterCompletion, model, systemBefore, userContent);
        const afterText = await generateSample(callOpenRouterCompletion, model, systemAfter, userContent);

        checkpoint.pairs.push({
          sceneId: scene.id,
          sceneLabel: scene.label,
          runIndex,
          before: {
            sceneId: scene.id,
            runIndex,
            version: "before",
            text: beforeText,
            metrics: analyzeHandTouchAudit(beforeText),
          },
          after: {
            sceneId: scene.id,
            runIndex,
            version: "after",
            text: afterText,
            metrics: analyzeHandTouchAudit(afterText),
          },
        });
        doneKeys.add(key);
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
      }
    }
  }

  const reports = buildReports(checkpoint.pairs);
  const verdict = evaluateFewShotAblation(reports);

  const result = {
    test: "fewshot-hand-vs-space-ablation",
    hypothesis: "space/sound/distance few-shot reduces hand/touch repetition vs hand-heavy few-shot",
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    pairedSamples: checkpoint.pairs.length,
    exampleDialog: {
      baselineHandLex: countHandLexInText(FEWSHOT_HAND_BASELINE),
      treatmentHandLex: countHandLexInText(FEWSHOT_SPACE_TREATMENT),
      baselineSpaceSoundLex: countSpaceSoundLexInText(FEWSHOT_HAND_BASELINE),
      treatmentSpaceSoundLex: countSpaceSoundLexInText(FEWSHOT_SPACE_TREATMENT),
    },
    metrics: reports,
    verdict,
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Hand/Touch Metrics (Hand few-shot → Space few-shot) ===");
  for (const r of reports) {
    const sig = r.significantAt95 ? "*" : "";
    console.log(
      `${r.label}${sig}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} winRate=${(r.winRate * 100).toFixed(0)}% p=${r.pairedTPValue} ${r.verdict}`
    );
  }

  console.log(`\n=== Verdict: ${verdict.keep ? "HYPOTHESIS SUPPORTED" : "NOT CONFIRMED"} ===`);
  console.log(verdict.reason);
  console.log(`Wrote ${resultPath}`);

  process.exit(verdict.keep ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
