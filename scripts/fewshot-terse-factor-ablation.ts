/**
 * Terse 42% — isolated factor ablations (hand vs space per factor arm).
 * Reuses existing few-shot templates only; no production changes.
 *
 * Usage:
 *   npx tsx scripts/fewshot-terse-factor-ablation.ts --analyze-only
 *   npx tsx scripts/fewshot-terse-factor-ablation.ts --factor=speech-tone --runs=2
 *   npx tsx scripts/fewshot-terse-factor-ablation.ts --fresh --runs=2
 */
import "./lib/server-only-mock";

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { PROSE_VARIATION_SCENES } from "./lib/prose-variation-metrics";
import {
  HAND_TOUCH_METRIC_DEFS,
  analyzeHandTouchAudit,
  handTouchMetricValue,
} from "./lib/hand-touch-audit-metrics";
import { proseSceneToFewShotScene } from "./lib/fewshot-hand-ablation-fixture";
import {
  ALL_DIAGNOSTIC_FACTORS,
  armsForFactor,
  buildExampleDialog,
  systemPromptForPersonality,
  type DiagnosticFactor,
  type FactorArm,
} from "./lib/fewshot-diagnostic-fixtures";
import { parseCharacterSetting } from "@/utils/characterParser";
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
const DEFAULT_RUNS = 2;

type PairRecord = {
  factorId: DiagnosticFactor;
  arm: "control" | "variant";
  armLabel: string;
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: { text: string; metrics: ReturnType<typeof analyzeHandTouchAudit> };
  after: { text: string; metrics: ReturnType<typeof analyzeHandTouchAudit> };
};

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

function parseFactorArg(): DiagnosticFactor | null {
  const arg = process.argv.find((a) => a.startsWith("--factor="));
  if (!arg) return null;
  const id = arg.split("=")[1] as DiagnosticFactor;
  if (!ALL_DIAGNOSTIC_FACTORS.includes(id)) throw new Error(`unknown --factor=${id}`);
  return id;
}

function pairKey(factorId: string, arm: string, sceneId: string, runIndex: number): string {
  return `${factorId}#${arm}#${sceneId}#${runIndex}`;
}

function buildChunks(arm: FactorArm, handHeavy: boolean) {
  const exampleDialog = buildExampleDialog(arm.profile, handHeavy, arm.lengthMode);
  return parseCharacterSetting({
    characterId: `diag-${arm.factorId}-${arm.arm}`,
    characterName: arm.profile.charName,
    gender: "other",
    systemPrompt: systemPromptForPersonality(arm.personality),
    world: `# 세계관\n현대·판타지 혼합 도시.`,
    exampleDialog,
    statusWindowPrompt: "",
  });
}

function summarizeTouch(pairs: PairRecord[]) {
  const touch = pairs.map((p) => ({
    b: p.before.metrics.touchShare,
    a: p.after.metrics.touchShare,
  }));
  const wins = touch.filter((x) => x.a < x.b).length;
  const beforeMean = touch.reduce((s, x) => s + x.b, 0) / (touch.length || 1);
  const afterMean = touch.reduce((s, x) => s + x.a, 0) / (touch.length || 1);
  return {
    n: pairs.length,
    touchWinRate: wins / (touch.length || 1),
    touchShareMeanBefore: beforeMean,
    touchShareMeanAfter: afterMean,
    touchDeltaMean: beforeMean - afterMean,
  };
}

function buildFactorReports(pairs: PairRecord[]) {
  const reports: PairedMetricReport[] = HAND_TOUCH_METRIC_DEFS.map((def) => {
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
      improvements.push(improvementDelta(b, a, def.higherIsBetter));
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
  return reports;
}

function diagnoseFactor(
  factorId: DiagnosticFactor,
  control: ReturnType<typeof summarizeTouch>,
  variant: ReturnType<typeof summarizeTouch>
): { verdict: string; explanation: string } {
  const REF_FORMAL = 0.83;
  const REF_TERSE = 0.42;
  const variantLift = variant.touchWinRate - control.touchWinRate;
  const variantNearFormal = variant.touchWinRate >= REF_FORMAL - 0.15;
  const controlNearOriginal = Math.abs(control.touchWinRate - REF_TERSE) <= 0.2;

  if (variantNearFormal && controlNearOriginal && variantLift >= 0.25) {
    return {
      verdict: "PRIMARY_CANDIDATE",
      explanation: `variant arm restores win rate toward formal (${(variant.touchWinRate * 100).toFixed(0)}% vs control ${(control.touchWinRate * 100).toFixed(0)}%)`,
    };
  }
  if (Math.abs(variantLift) < 0.1 && Math.abs(variant.touchWinRate - control.touchWinRate) < 0.1) {
    return {
      verdict: "UNLIKELY",
      explanation: `control and variant win rates similar (${(control.touchWinRate * 100).toFixed(0)}% vs ${(variant.touchWinRate * 100).toFixed(0)}%)`,
    };
  }
  if (variantLift > 0.15) {
    return {
      verdict: "PARTIAL",
      explanation: `variant improves over control by ${(variantLift * 100).toFixed(0)}pp but not to formal band`,
    };
  }
  return {
    verdict: "INCONCLUSIVE",
    explanation: `control ${(control.touchWinRate * 100).toFixed(0)}%, variant ${(variant.touchWinRate * 100).toFixed(0)}%`,
  };
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const analyzeOnly = process.argv.includes("--analyze-only");
  const runsPerScene = parseRunsArg();
  const singleFactor = parseFactorArg();
  const factors = singleFactor ? [singleFactor] : ALL_DIAGNOSTIC_FACTORS;

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "fewshot-terse-factor-ablation-checkpoint.json");
  const resultPath = join(outDir, "fewshot-terse-factor-ablation.json");

  if (analyzeOnly) {
    if (!existsSync(checkpointPath) && !existsSync(resultPath)) {
      console.error("No checkpoint/result — run without --analyze-only first");
      process.exit(1);
    }
    const data = JSON.parse(
      readFileSync(existsSync(resultPath) ? resultPath : checkpointPath, "utf8")
    ) as { perFactor: unknown[] };
    console.log(JSON.stringify(data.perFactor, null, 2));
    return;
  }

  const { buildContext } = await import("@/services/contextBuilder");
  const personaDisplayName = "렌";
  const shared = {
    userPersona: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대."),
    userNote: formatUserNoteForPrompt("지인."),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta("{}")),
    nsfw: true,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 6,
    provider: "openrouter" as const,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };

  function systemFor(arm: FactorArm, sceneId: string, handHeavy: boolean): string {
    const proseScene = PROSE_VARIATION_SCENES.find((s) => s.id === sceneId)!;
    const scene = proseSceneToFewShotScene(proseScene);
    return buildContext({
      charName: arm.profile.charName,
      personaDisplayName,
      userNickname: personaDisplayName,
      chunks: buildChunks(arm, handHeavy),
      ...shared,
      gender: "male",
      shortTermHistory: scene.shortTermHistory,
      currentUserMessage: scene.currentUserMessage,
      genres: scene.genres,
    }).systemPrompt;
  }

  const jobsPerFactor = 2 * PROSE_VARIATION_SCENES.length * runsPerScene;
  const totalJobs = factors.length * jobsPerFactor;
  console.log("=== Terse Factor Ablation (hand vs space per arm) ===");
  console.log(`Factors: ${factors.join(", ")} | runs/scene: ${runsPerScene} | paired jobs: ${totalJobs} | API: ${totalJobs * 2}`);

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }

  if (fresh && existsSync(checkpointPath)) unlinkSync(checkpointPath);

  type Checkpoint = { pairs: PairRecord[]; runsPerScene: number };
  let checkpoint: Checkpoint = existsSync(checkpointPath)
    ? (JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint)
    : { pairs: [], runsPerScene };

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const done = new Set(
    checkpoint.pairs.map((p) => pairKey(p.factorId, p.arm, p.sceneId, p.runIndex))
  );
  let n = done.size;

  for (const factorId of factors) {
    const arms = armsForFactor(factorId);
    for (const arm of arms) {
      for (const scene of PROSE_VARIATION_SCENES) {
        const userContent = `${scene.setup}\n\n${scene.user}`;
        for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
          const key = pairKey(factorId, arm.arm, scene.id, runIndex);
          if (done.has(key)) continue;
          console.log(`[${++n}/${totalJobs}] ${factorId} · ${arm.arm} · ${scene.label} run ${runIndex + 1}`);

          const sysBefore = systemFor(arm, scene.id, true);
          const sysAfter = systemFor(arm, scene.id, false);

          for (let attempt = 0; attempt < 6; attempt++) {
            try {
              const beforeRes = await callOpenRouterCompletion({
                system: sysBefore,
                history: [{ role: "user", content: userContent }],
                model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
                temperature: TEMPERATURE,
                maxTokens: 4096,
                requestKind: "fewshot-terse-factor-ablation",
              });
              const afterRes = await callOpenRouterCompletion({
                system: sysAfter,
                history: [{ role: "user", content: userContent }],
                model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
                temperature: TEMPERATURE,
                maxTokens: 4096,
                requestKind: "fewshot-terse-factor-ablation",
              });
              const beforeText = beforeRes.text.trim();
              const afterText = afterRes.text.trim();
              if (beforeText.length < 200 || afterText.length < 200) throw new Error("short");

              checkpoint.pairs.push({
                factorId,
                arm: arm.arm,
                armLabel: arm.label,
                sceneId: scene.id,
                sceneLabel: scene.label,
                runIndex,
                before: { text: beforeText, metrics: analyzeHandTouchAudit(beforeText) },
                after: { text: afterText, metrics: analyzeHandTouchAudit(afterText) },
              });
              done.add(key);
              writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
              break;
            } catch (e) {
              if (attempt === 5) throw e;
              await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            }
          }
        }
      }
    }
  }

  const perFactor = factors.map((factorId) => {
    const arms = armsForFactor(factorId);
    const controlPairs = checkpoint.pairs.filter((p) => p.factorId === factorId && p.arm === "control");
    const variantPairs = checkpoint.pairs.filter((p) => p.factorId === factorId && p.arm === "variant");
    const controlTouch = summarizeTouch(controlPairs);
    const variantTouch = summarizeTouch(variantPairs);
    const diagnosis = diagnoseFactor(factorId, controlTouch, variantTouch);
    return {
      factorId,
      controlLabel: arms.find((a) => a.arm === "control")!.label,
      variantLabel: arms.find((a) => a.arm === "variant")!.label,
      control: { touch: controlTouch, metrics: buildFactorReports(controlPairs) },
      variant: { touch: variantTouch, metrics: buildFactorReports(variantPairs) },
      diagnosis,
    };
  });

  const result = {
    test: "fewshot-terse-factor-ablation",
    runsPerScene,
    referenceTerseWinRate: 0.42,
    referenceFormalWinRate: 0.83,
    perFactor,
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Factor diagnosis (touch share win rate) ===");
  for (const f of perFactor) {
    console.log(
      `${f.factorId}: control ${(f.control.touch.touchWinRate * 100).toFixed(0)}% | variant ${(f.variant.touch.touchWinRate * 100).toFixed(0)}% → ${f.diagnosis.verdict}`
    );
  }
  console.log(`\nWrote ${resultPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
