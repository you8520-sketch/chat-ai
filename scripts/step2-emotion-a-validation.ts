/**
 * Step 2 incremental validation — EMOTION A only.
 *
 * 4 scenes × 5 runs × Before/After = 20 pairs (40 API calls)
 *
 * Usage:
 *   npx tsx scripts/step2-emotion-a-validation.ts --fresh
 *   npx tsx scripts/step2-emotion-a-validation.ts --analyze-only
 *   npx tsx scripts/step2-emotion-a-validation.ts --dry-run
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";
import {
  PROSE_VARIATION_SCENES,
  buildProseVariationSystem,
} from "./lib/prose-variation-metrics";
import {
  HAND_TOUCH_METRIC_DEFS,
  analyzeHandTouchAudit,
  handTouchMetricValue,
  type HandTouchAuditMetrics,
  type HandTouchMetricKey,
} from "./lib/hand-touch-audit-metrics";
import {
  buildProseStyleSectionForStep2,
  PROSE_EMOTION_LINE3_A,
  PROSE_EMOTION_LINE3_BASELINE,
} from "@/lib/proseStyleStep2Variants";
import {
  buildPairedMetricReport,
  type PairedMetricReport,
} from "./lib/paired-comparison-stats";
import { improvementDelta, isAfterBetter } from "./lib/prose-variation-metrics";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system,
        history: [{ role: "user", content: userContent }],
        model,
        temperature: TEMPERATURE,
        maxTokens: 4096,
        requestKind: "step2-emotion-a-validation",
      });
      const text = res.text.trim();
      if (text.length >= 200) return text;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 2500));
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

function evaluateStep2EmotionA(reports: PairedMetricReport[]): {
  keep: boolean;
  rollback: boolean;
  reason: string;
  improvedSig: number;
  worseSig: number;
} {
  const improvedSig = reports.filter((r) => r.significantAt95 && r.verdict === "improved");
  const worseSig = reports.filter((r) => r.significantAt95 && r.verdict === "worse");
  const improvedAny = reports.filter((r) => r.verdict === "improved");
  const worseAny = reports.filter((r) => r.verdict === "worse");

  if (worseSig.length > 0) {
    return {
      keep: false,
      rollback: true,
      reason: `Regression: ${worseSig.map((r) => r.label).join(", ")} significant worse`,
      improvedSig: improvedSig.length,
      worseSig: worseSig.length,
    };
  }

  if (improvedSig.length >= 1) {
    return {
      keep: true,
      rollback: false,
      reason: `Confirmed: ${improvedSig.map((r) => r.label).join(", ")} significant improvement`,
      improvedSig: improvedSig.length,
      worseSig: 0,
    };
  }

  if (improvedAny.length >= 2 && worseAny.length === 0) {
    return {
      keep: true,
      rollback: false,
      reason: `Directional: ${improvedAny.length}/4 metrics improved, none worse (not all significant)`,
      improvedSig: 0,
      worseSig: 0,
    };
  }

  return {
    keep: false,
    rollback: true,
    reason: "No statistically confirmed improvement — inconclusive or flat",
    improvedSig: 0,
    worseSig: 0,
  };
}

async function applyEmotionAIfKeep(keep: boolean): Promise<void> {
  if (!keep) return;
  const { readFile, writeFile } = await import("node:fs/promises");
  const path = join(process.cwd(), "src", "lib", "advancedProseNsfwGuidelines.ts");
  let src = await readFile(path, "utf8");
  if (!src.includes(PROSE_EMOTION_LINE3_BASELINE)) {
    console.log("EMOTION A already applied or baseline line missing — skip file apply");
    return;
  }
  src = src.replace(PROSE_EMOTION_LINE3_BASELINE, PROSE_EMOTION_LINE3_A);
  await writeFile(path, src, "utf8");
  console.log(`Applied EMOTION A to ${path}`);
}

async function main() {
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const dryRun = process.argv.includes("--dry-run");
  const runsPerScene = parseRunsArg();
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step2-emotion-a-checkpoint.json");
  const resultPath = join(outDir, "step2-emotion-a-validation.json");

  const { buildAdvancedProseNsfwGuidelines } = await import("@/lib/advancedProseNsfwGuidelines");
  const bundleBefore = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    proseStyleSection: buildProseStyleSectionForStep2("baseline"),
  });
  const bundleAfter = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    proseStyleSection: buildProseStyleSectionForStep2("emotion-a"),
  });
  writeFileSync(join(outDir, "prose-bundle-step2-emotion-baseline.txt"), bundleBefore, "utf8");
  writeFileSync(join(outDir, "prose-bundle-step2-emotion-a.txt"), bundleAfter, "utf8");

  const totalPairs = PROSE_VARIATION_SCENES.length * runsPerScene;
  const totalApiCalls = totalPairs * 2;
  console.log("=== Step 2 EMOTION A Validation ===");
  console.log(`Scenes: ${PROSE_VARIATION_SCENES.length} | Runs: ${runsPerScene} | Paired jobs: ${totalPairs} | API calls: ${totalApiCalls}`);
  console.log("\nBefore [EMOTION] line3:");
  console.log(`  ${PROSE_EMOTION_LINE3_BASELINE}`);
  console.log("\nAfter [EMOTION] line3 (A):");
  console.log(`  ${PROSE_EMOTION_LINE3_A}`);
  console.log(`\nBundle Δ: ${bundleBefore.length} → ${bundleAfter.length} chars (${bundleAfter.length - bundleBefore.length})`);

  if (dryRun) {
    console.log("\n--dry-run: skipping API");
    return;
  }

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("\nCleared checkpoint (--fresh)");
  }

  const systemBefore = buildProseVariationSystem(bundleBefore);
  const systemAfter = buildProseVariationSystem(bundleAfter);

  let checkpoint: Checkpoint;

  if (analyzeOnly) {
    if (!existsSync(checkpointPath)) {
      console.error("No checkpoint — run without --analyze-only first");
      process.exit(1);
    }
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
  } else {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY required");
      process.exit(1);
    }
    const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
    const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");
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
  const verdict = evaluateStep2EmotionA(reports);

  const result = {
    test: "step2-emotion-a-incremental",
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    pairedSamples: checkpoint.pairs.length,
    metrics: reports,
    verdict,
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Hand/Touch Metrics (Before → After) ===");
  for (const r of reports) {
    const sig = r.significantAt95 ? "*" : "";
    console.log(
      `${r.label}${sig}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} winRate=${(r.winRate * 100).toFixed(0)}% p=${r.pairedTPValue} ${r.verdict}`
    );
  }

  console.log(`\n=== Verdict: ${verdict.keep ? "KEEP EMOTION A" : "ROLLBACK"} ===`);
  console.log(verdict.reason);
  console.log(`Wrote ${resultPath}`);

  if (!analyzeOnly) {
    if (verdict.keep) {
      await applyEmotionAIfKeep(true);
    } else {
      console.log("No production change — baseline PROSE retained");
    }
  }

  process.exit(verdict.keep ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
