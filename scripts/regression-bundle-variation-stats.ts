/**
 * Step 1 statistical regression — 4 scenes × N paired runs × 2 conditions.
 * Default: 5 runs/scene → 20 pairs → 40 API calls.
 *
 * Usage:
 *   npx tsx scripts/regression-bundle-variation-stats.ts
 *   npx tsx scripts/regression-bundle-variation-stats.ts --fresh
 *   npx tsx scripts/regression-bundle-variation-stats.ts --analyze-only
 *   npx tsx scripts/regression-bundle-variation-stats.ts --runs=5
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";
import {
  PROSE_VARIATION_SCENES,
  VARIATION_METRIC_DEFS,
  analyzeProseVariation,
  buildProseVariationSystem,
  improvementDelta,
  isAfterBetter,
  metricValue,
  type ProseVariationMetrics,
  type VariationMetricKey,
} from "./lib/prose-variation-metrics";
import {
  buildPairedMetricReport,
  type PairedMetricReport,
} from "./lib/paired-comparison-stats";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const DEFAULT_RUNS = 5;
const TEMPERATURE = 0.85;

/** Rough USD/call (DeepSeek V4 Pro, ~2800 prompt + ~425 output tok, prefix cache blended). */
function estimateRunCostUsd(apiCalls: number): { low: number; high: number } {
  const cached = 0.00038;
  const cold = 0.00159;
  const low = apiCalls * cached;
  const high = apiCalls * cold;
  return { low: Math.round(low * 1000) / 1000, high: Math.round(high * 1000) / 1000 };
}

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  version: "before" | "after";
  text: string;
  charLength: number;
  metrics: ProseVariationMetrics;
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
  bundleBeforeChars: number;
  bundleAfterChars: number;
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

function loadCheckpoint(path: string): Checkpoint | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
}

function saveCheckpoint(path: string, data: Checkpoint): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
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
        requestKind: "bundle-regression-stats",
      });
      const text = res.text.trim();
      if (text.length >= 200) return text;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Completion too short after retries");
}

function buildMetricReports(pairs: PairRecord[]): PairedMetricReport[] {
  return VARIATION_METRIC_DEFS.map((def) => {
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;

    for (const pair of pairs) {
      const b = metricValue(pair.before.metrics, def.key);
      const a = metricValue(pair.after.metrics, def.key);
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

function printMetricBlock(title: string, reports: PairedMetricReport[]): void {
  console.log(`\n=== ${title} ===`);
  for (const r of reports) {
    const dir = r.higherIsBetter ? "↑" : "↓";
    const sig = r.significantAt95 ? "SIGNIFICANT" : "not significant";
    console.log(`\n[${r.label}] (${dir}) — ${sig} (${r.verdict})`);
    console.log(
      `  before  mean=${r.before.mean} median=${r.before.median} stddev=${r.before.stddev}`
    );
    console.log(
      `  after   mean=${r.after.mean} median=${r.after.median} stddev=${r.after.stddev}`
    );
    console.log(
      `  Δ       mean=${r.improvement.mean} median=${r.improvement.median} stddev=${r.improvement.stddev}`
    );
    console.log(
      `  winRate=${(r.winRate * 100).toFixed(1)}% (${r.wins}/${r.pairedN}) | binomial p=${r.binomialPValue} | wilcoxon p=${r.wilcoxonPValue} | paired-t p=${r.pairedTPValue}`
    );
    console.log(`  95% CI improvement: [${r.ci95Improvement[0]}, ${r.ci95Improvement[1]}]`);
  }
}

function summarizeSignificance(reports: PairedMetricReport[]): {
  improved: number;
  worse: number;
  inconclusive: number;
} {
  return {
    improved: reports.filter((r) => r.verdict === "improved").length,
    worse: reports.filter((r) => r.verdict === "worse").length,
    inconclusive: reports.filter((r) => r.verdict === "inconclusive").length,
  };
}

async function main() {
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const runsPerScene = parseRunsArg();
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "bundle-regression-stats-checkpoint.json");
  const resultPath = join(outDir, "bundle-regression-variation-stats.json");
  const summaryPath = join(outDir, "bundle-regression-variation-stats-summary.txt");

  const totalPairs = PROSE_VARIATION_SCENES.length * runsPerScene;
  const totalApiCalls = totalPairs * 2;
  const cost = estimateRunCostUsd(totalApiCalls);
  console.log(
    `Plan: ${PROSE_VARIATION_SCENES.length} scenes × ${runsPerScene} paired runs = ${totalPairs} pairs (${totalApiCalls} API calls)`
  );
  console.log(`Estimated cost: $${cost.low}–$${cost.high} USD (cache blended – cold upper bound)`);

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("Cleared checkpoint (--fresh)");
  }

  const { buildAdvancedProseNsfwGuidelines } = await import("@/lib/advancedProseNsfwGuidelines");
  const beforePath = join(outDir, "prose-bundle-before.txt");
  const bundleBefore = readFileSync(beforePath, "utf8");
  const bundleAfter = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
  const systemBefore = buildProseVariationSystem(bundleBefore);
  const systemAfter = buildProseVariationSystem(bundleAfter);

  let checkpoint: Checkpoint;

  if (analyzeOnly) {
    const loaded = loadCheckpoint(checkpointPath);
    if (!loaded || loaded.pairs.length === 0) {
      console.error("No checkpoint found — run without --analyze-only first");
      process.exit(1);
    }
    checkpoint = loaded;
    console.log(`Analyzing ${checkpoint.pairs.length} paired samples from checkpoint`);
  } else {
    const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
    const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");

    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY required");
      process.exit(1);
    }

    const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
    const existing = fresh ? null : loadCheckpoint(checkpointPath);
    if (
      existing &&
      existing.runsPerScene !== runsPerScene &&
      existing.pairs.length > 0
    ) {
      console.error(
        `Checkpoint has runsPerScene=${existing.runsPerScene} but --runs=${runsPerScene}. Use --fresh to restart.`
      );
      process.exit(1);
    }
    const doneKeys = new Set(
      (existing?.pairs ?? []).map((p) => pairKey(p.sceneId, p.runIndex))
    );

    checkpoint = {
      model,
      temperature: TEMPERATURE,
      runsPerScene,
      bundleBeforeChars: bundleBefore.length,
      bundleAfterChars: bundleAfter.length,
      pairs: existing?.pairs ?? [],
    };

    const totalPairs = PROSE_VARIATION_SCENES.length * runsPerScene;
    let completed = doneKeys.size;

    for (const scene of PROSE_VARIATION_SCENES) {
      const userContent = `${scene.setup}\n\n${scene.user}`;

      for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (doneKeys.has(key)) continue;

        console.log(
          `[${completed + 1}/${totalPairs}] ${scene.label} run ${runIndex + 1}/${runsPerScene}`
        );

        const beforeText = await generateSample(
          callOpenRouterCompletion,
          model,
          systemBefore,
          userContent
        );
        const afterText = await generateSample(
          callOpenRouterCompletion,
          model,
          systemAfter,
          userContent
        );

        const beforeRecord: SampleRecord = {
          sceneId: scene.id,
          runIndex,
          version: "before",
          text: beforeText,
          charLength: beforeText.length,
          metrics: analyzeProseVariation(beforeText),
        };
        const afterRecord: SampleRecord = {
          sceneId: scene.id,
          runIndex,
          version: "after",
          text: afterText,
          charLength: afterText.length,
          metrics: analyzeProseVariation(afterText),
        };

        checkpoint.pairs.push({
          sceneId: scene.id,
          sceneLabel: scene.label,
          runIndex,
          before: beforeRecord,
          after: afterRecord,
        });
        doneKeys.add(key);
        completed++;
        saveCheckpoint(checkpointPath, checkpoint);
      }
    }
  }

  const byScene = new Map<string, PairRecord[]>();
  for (const pair of checkpoint.pairs) {
    const list = byScene.get(pair.sceneId) ?? [];
    list.push(pair);
    byScene.set(pair.sceneId, list);
  }

  const sceneReports: Record<string, PairedMetricReport[]> = {};
  for (const scene of PROSE_VARIATION_SCENES) {
    const pairs = byScene.get(scene.id) ?? [];
    pairs.sort((a, b) => a.runIndex - b.runIndex);
    sceneReports[scene.id] = buildMetricReports(pairs);
  }

  const overallReports = buildMetricReports(checkpoint.pairs);
  const overallSig = summarizeSignificance(overallReports);

  const result = {
    test: "step1-bundle-regression-stats",
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    totalSamples: checkpoint.pairs.length * 2,
    pairedSamples: checkpoint.pairs.length,
    bundleBeforeChars: checkpoint.bundleBeforeChars,
    bundleAfterChars: checkpoint.bundleAfterChars,
    significanceLevel: 0.05,
    overall: {
      metrics: overallReports,
      summary: overallSig,
      step1Confirmed:
        overallSig.improved >= 4 &&
        overallSig.worse === 0 &&
        overallReports.filter((r) => r.significantAt95).length >= 3,
    },
    scenes: PROSE_VARIATION_SCENES.map((scene) => ({
      id: scene.id,
      label: scene.label,
      pairedN: (byScene.get(scene.id) ?? []).length,
      metrics: sceneReports[scene.id],
      summary: summarizeSignificance(sceneReports[scene.id] ?? []),
    })),
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  const lines: string[] = [
    "Step 1 Bundle Regression — Statistical Evaluation",
    `Model: ${checkpoint.model} | temp: ${checkpoint.temperature} | pairs: ${checkpoint.pairs.length}`,
    "",
    "OVERALL",
  ];
  for (const r of overallReports) {
    lines.push(
      `${r.label}: winRate=${(r.winRate * 100).toFixed(1)}% meanΔ=${r.improvement.mean} significant=${r.significantAt95} verdict=${r.verdict}`
    );
  }
  lines.push(
    "",
    `Overall: improved=${overallSig.improved} worse=${overallSig.worse} inconclusive=${overallSig.inconclusive}`,
    `Step1 confirmed (heuristic): ${result.overall.step1Confirmed}`,
    ""
  );
  for (const scene of result.scenes) {
    lines.push(`SCENE: ${scene.label} (n=${scene.pairedN})`);
    for (const r of scene.metrics) {
      lines.push(
        `  ${r.label}: winRate=${(r.winRate * 100).toFixed(1)}% meanΔ=${r.improvement.mean} sig=${r.significantAt95}`
      );
    }
    lines.push("");
  }
  writeFileSync(summaryPath, lines.join("\n"), "utf8");

  console.log(`\nWrote ${resultPath}`);
  console.log(`Wrote ${summaryPath}`);

  printMetricBlock("OVERALL (all paired runs)", overallReports);
  console.log(
    `\nOverall significance summary: improved=${overallSig.improved} worse=${overallSig.worse} inconclusive=${overallSig.inconclusive}`
  );
  console.log(`Step 1 effect confirmed (heuristic): ${result.overall.step1Confirmed}`);

  for (const scene of PROSE_VARIATION_SCENES) {
    printMetricBlock(`SCENE: ${scene.label}`, sceneReports[scene.id] ?? []);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
