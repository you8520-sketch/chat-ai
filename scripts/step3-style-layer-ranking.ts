import "./lib/server-only-mock";

/**
 * Step 3-1 — Full Style Responsibility Ranking (audit only)
 *
 * ON/OFF ablation per production style layer; builds Contribution Matrix + ROI ranking.
 * Does NOT modify src rules or production prompts.
 *
 * Usage:
 *   npx tsx scripts/step3-style-layer-ranking.ts --diff-only
 *   npx tsx scripts/step3-style-layer-ranking.ts --fresh
 *   npx tsx scripts/step3-style-layer-ranking.ts --runs=1
 *   npx tsx scripts/step3-style-layer-ranking.ts --layers=lengthControl,proseStyle --scene=horror
 *   npx tsx scripts/step3-style-layer-ranking.ts --analyze-only
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  STYLE_LAYERS,
  applyLayerOff,
  buildContextWithFewShotOff,
  promptDiffSummary,
  type StyleLayerId,
} from "./lib/style-layer-ablation";
import {
  PRODUCTION_VALIDATION_SCENES,
  buildProductionContextForScene,
} from "./lib/production-prompt-fixture";
import {
  STYLE_CONTRIBUTION_METRIC_DEFS,
  analyzeStyleContribution,
  layerContributionDelta,
  type StyleContributionMetricKey,
  type StyleContributionMetrics,
} from "./lib/style-contribution-metrics";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TEMPERATURE = 0.85;
const DEFAULT_RUNS = 1;
const CHECKPOINT_PATH = join(process.cwd(), "output", "step3-style-layer-ranking-checkpoint.json");
const RESULT_JSON = join(process.cwd(), "output", "step3-style-layer-ranking.json");
const RESULT_SUMMARY = join(process.cwd(), "output", "step3-style-layer-ranking-summary.txt");

type PairRecord = {
  layerId: StyleLayerId;
  sceneId: string;
  runIndex: number;
  before: { text: string; metrics: StyleContributionMetrics };
  after: { text: string; metrics: StyleContributionMetrics };
};

type Checkpoint = {
  model: string;
  temperature: number;
  runsPerScene: number;
  pairs: PairRecord[];
};

type ContributionCell = {
  metric: StyleContributionMetricKey;
  label: string;
  onMean: number;
  offMean: number;
  contribution: number;
  absContribution: number;
  higherIsBetter: boolean;
  significant: boolean;
};

type LayerRankingRow = {
  layerId: StyleLayerId;
  label: string;
  labelKo: string;
  source: string;
  promptCharsRemoved: number;
  roiScore: number;
  priority: number;
  risk: "Low" | "Medium" | "High";
  topMetricDrivers: string[];
  interactions: string[];
  overallHumanContribution: number;
  narrationWallContribution: number;
  dialogueRhythmContribution: number;
  handFrequencyContribution: number;
  cells: ContributionCell[];
};

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

function parseLayersFilter(): StyleLayerId[] | null {
  const arg = process.argv.find((a) => a.startsWith("--layers="));
  if (!arg) return null;
  const ids = arg
    .split("=")[1]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) as StyleLayerId[];
  const valid = ids.filter((id) => STYLE_LAYERS.some((l) => l.id === id));
  return valid.length > 0 ? valid : null;
}

function parseScenesFilter() {
  const arg = process.argv.find((a) => a.startsWith("--scene="));
  if (!arg) return PRODUCTION_VALIDATION_SCENES;
  const id = arg.split("=")[1]?.trim();
  const filtered = PRODUCTION_VALIDATION_SCENES.filter((s) => s.id === id);
  if (filtered.length === 0) {
    console.error(
      `Unknown --scene=${id}. Valid: ${PRODUCTION_VALIDATION_SCENES.map((s) => s.id).join(", ")}`
    );
    process.exit(1);
  }
  return filtered;
}

function pairKey(layerId: string, sceneId: string, runIndex: number): string {
  return `${layerId}#${sceneId}#${runIndex}`;
}

function layerPromptDelta(before: string, after: string): number {
  return before.length - after.length;
}

async function assembleBaseline(scene: (typeof PRODUCTION_VALIDATION_SCENES)[number]): Promise<{
  systemOn: string;
  userContent: string;
  history: { role: "user" | "assistant"; content: string }[];
}> {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  return { systemOn: built.systemPrompt, userContent, history };
}

async function assembleLayerOff(
  scene: (typeof PRODUCTION_VALIDATION_SCENES)[number],
  layerId: StyleLayerId
): Promise<string> {
  if (layerId === "fewShot") {
    const { buildContext } = await import("@/services/contextBuilder");
    const built = buildContext(buildContextWithFewShotOff(scene));
    return built.systemPrompt;
  }
  const { systemOn } = await assembleBaseline(scene);
  return applyLayerOff(systemOn, layerId);
}

async function generateSample(
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion,
  model: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  userContent: string
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system,
        history: [...history, { role: "user", content: userContent }],
        model,
        temperature: TEMPERATURE,
        maxTokens: 4096,
        requestKind: "step3-style-layer-ranking",
      });
      const text = res.text.trim();
      if (text.length >= 400) return text;
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw new Error("Completion too short after retries");
}

function buildLayerReports(
  pairs: PairRecord[],
  layerId: StyleLayerId
): PairedMetricReport[] {
  const layerPairs = pairs.filter((p) => p.layerId === layerId);
  return STYLE_CONTRIBUTION_METRIC_DEFS.map((def) => {
    const beforeValues = layerPairs.map((p) => p.before.metrics[def.key]);
    const afterValues = layerPairs.map((p) => p.after.metrics[def.key]);
    const improvements = layerPairs.map((p) =>
      layerContributionDelta(
        p.before.metrics[def.key],
        p.after.metrics[def.key],
        def.higherIsBetter
      )
    );
    let wins = 0;
    let ties = 0;
    for (let i = 0; i < layerPairs.length; i++) {
      const imp = improvements[i]!;
      if (imp === 0) ties++;
      else if (imp > 0) wins++;
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

function classifyRisk(
  layer: (typeof STYLE_LAYERS)[number],
  reports: PairedMetricReport[],
  overallContribution: number
): "Low" | "Medium" | "High" {
  const sigCount = reports.filter((r) => r.significantAt95).length;
  const absOverall = Math.abs(overallContribution);
  if (sigCount >= 3 || absOverall >= 1.2) return "High";
  if (sigCount >= 1 || absOverall >= 0.5 || layer.defaultRisk === "High") return "Medium";
  return layer.defaultRisk === "Low" ? "Low" : "Medium";
}

function buildRanking(
  pairs: PairRecord[],
  promptDeltas: Record<StyleLayerId, number>,
  activeLayers: typeof STYLE_LAYERS
): LayerRankingRow[] {
  const rows: LayerRankingRow[] = [];

  for (const layer of activeLayers) {
    const reports = buildLayerReports(pairs, layer.id);
    const cells: ContributionCell[] = reports.map((r) => {
      const def = STYLE_CONTRIBUTION_METRIC_DEFS.find((d) => d.key === r.metricKey)!;
      const contribution = layerContributionDelta(
        r.before.mean,
        r.after.mean,
        def.higherIsBetter
      );
      return {
        metric: r.metricKey as StyleContributionMetricKey,
        label: r.label,
        onMean: r.before.mean,
        offMean: r.after.mean,
        contribution,
        absContribution: Math.abs(contribution),
        higherIsBetter: def.higherIsBetter,
        significant: r.significantAt95,
      };
    });

    const charsRemoved = Math.abs(promptDeltas[layer.id] ?? 0) || 1;
    const roiScore =
      Math.round((cells.reduce((s, c) => s + c.absContribution, 0) / charsRemoved) * 10000) / 10000;

    const overallHumanContribution =
      cells.find((c) => c.metric === "overallHumanScore")?.contribution ?? 0;
    const narrationWallContribution = cells.find((c) => c.metric === "narrationWall")?.contribution ?? 0;
    const dialogueRhythmContribution = cells.find((c) => c.metric === "dialogueRhythm")?.contribution ?? 0;
    const handFrequencyContribution = cells.find((c) => c.metric === "handFrequency")?.contribution ?? 0;

    const topMetricDrivers = [...cells]
      .sort((a, b) => b.absContribution - a.absContribution)
      .slice(0, 3)
      .map((c) => `${c.label} (${c.contribution >= 0 ? "+" : ""}${c.contribution})`);

    rows.push({
      layerId: layer.id,
      label: layer.label,
      labelKo: layer.labelKo,
      source: layer.source,
      promptCharsRemoved: charsRemoved,
      roiScore,
      priority: 0,
      risk: classifyRisk(layer, reports, overallHumanContribution),
      topMetricDrivers,
      interactions: layer.staticInteractions,
      overallHumanContribution,
      narrationWallContribution,
      dialogueRhythmContribution,
      handFrequencyContribution,
      cells,
    });
  }

  rows.sort((a, b) => b.roiScore - a.roiScore);
  rows.forEach((r, i) => {
    r.priority = i + 1;
  });
  return rows;
}

function formatContributionMatrix(rows: LayerRankingRow[]): string {
  const metricCols = STYLE_CONTRIBUTION_METRIC_DEFS.filter(
    (d) => d.key !== "charLength"
  );
  const header = ["Layer", ...metricCols.map((m) => m.label.slice(0, 14))].join("\t");
  const lines = [header];
  for (const row of rows) {
    const vals = metricCols.map((m) => {
      const cell = row.cells.find((c) => c.metric === m.key);
      if (!cell) return "—";
      const mark = cell.significant ? "*" : "";
      return `${cell.contribution >= 0 ? "+" : ""}${cell.contribution}${mark}`;
    });
    lines.push([row.label, ...vals].join("\t"));
  }
  lines.push("");
  lines.push("* = p<0.05 paired significance (screening n may be underpowered)");
  return lines.join("\n");
}

function formatRankingTable(rows: LayerRankingRow[]): string {
  const lines = [
    "ROI Ranking (impact per char removed)",
    "Rank\tLayer\tROI\tRisk\tOverall Δ\tTop drivers",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.priority,
        r.label,
        r.roiScore.toFixed(4),
        r.risk,
        `${r.overallHumanContribution >= 0 ? "+" : ""}${r.overallHumanContribution}`,
        r.topMetricDrivers.join("; "),
      ].join("\t")
    );
  }
  return lines.join("\n");
}

function formatInteractionTable(rows: LayerRankingRow[]): string {
  const lines = ["Layer interactions (static + empirical overlap)", ""];
  for (const r of rows) {
    lines.push(`${r.label}:`);
    for (const note of r.interactions) {
      lines.push(`  - ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeSummary(rows: LayerRankingRow[], meta: Record<string, unknown>): void {
  const top = rows[0];
  const body = [
    "Step 3-1 — Full Style Responsibility Ranking (audit only)",
    "No production / prompt rule changes applied.",
    "",
    `Samples: ${meta.samplePairs} paired jobs (${meta.runsPerScene} run/scene × ${meta.sceneCount} scenes × ${meta.layerCount} layers)`,
    `Model: ${meta.model}`,
    "",
    "=== Headline ===",
    top
      ? `#1 style driver (ROI): ${top.label} — ROI=${top.roiScore}, overallHuman Δ=${top.overallHumanContribution >= 0 ? "+" : ""}${top.overallHumanContribution}`
      : "(no data)",
    "",
    "=== Contribution Matrix (positive = layer ON helps; negative = layer ON hurts) ===",
    formatContributionMatrix(rows),
    "",
    "=== ROI Ranking ===",
    formatRankingTable(rows),
    "",
    "=== Priority / Risk ===",
    ...rows.map(
      (r) =>
        `P${r.priority} ${r.label} — Risk: ${r.risk} | chars removed: ${r.promptCharsRemoved} | narrationWall Δ=${r.narrationWallContribution} | dialogueRhythm Δ=${r.dialogueRhythmContribution} | handFreq Δ=${r.handFrequencyContribution}`
    ),
    "",
    "=== Interactions ===",
    formatInteractionTable(rows),
    "",
    "Note: overallHumanScore is heuristic composite from webnovel-style-audit (proxy, not human raters).",
  ].join("\n");
  writeFileSync(RESULT_SUMMARY, body, "utf8");
}

async function printDiffs(): Promise<void> {
  const scene = PRODUCTION_VALIDATION_SCENES[0]!;
  const { systemOn } = await assembleBaseline(scene);
  console.log("=== Step 3-1 Layer Prompt Diffs (horror baseline) ===\n");
  console.log(`All layers ON: ${systemOn.length} chars\n`);

  for (const layer of STYLE_LAYERS) {
    const systemOff = await assembleLayerOff(scene, layer.id);
    const diff = promptDiffSummary(systemOn, systemOff);
    console.log(
      `${layer.id}: ${diff.deltaChars} chars (OFF ${diff.afterChars} vs ON ${diff.beforeChars})`
    );
  }
}

async function main() {
  const diffOnly = process.argv.includes("--diff-only");
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const runsPerScene = parseRunsArg();
  const layerFilter = parseLayersFilter();
  const activeLayers = layerFilter
    ? STYLE_LAYERS.filter((l) => layerFilter.includes(l.id))
    : STYLE_LAYERS;
  const activeScenes = parseScenesFilter();

  mkdirSync(join(process.cwd(), "output"), { recursive: true });

  if (diffOnly) {
    await printDiffs();
    return;
  }

  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");
  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  let pairs: PairRecord[] = [];
  if (!fresh && existsSync(CHECKPOINT_PATH)) {
    const ck = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as Checkpoint;
    pairs = ck.pairs ?? [];
    console.log(`Resumed checkpoint: ${pairs.length} pairs`);
  }

  const promptDeltas = {} as Record<StyleLayerId, number>;
  const scene0 = activeScenes[0]!;
  const { systemOn: baselinePrompt } = await assembleBaseline(scene0);
  for (const layer of activeLayers) {
    const offPrompt = await assembleLayerOff(scene0, layer.id);
    promptDeltas[layer.id] = layerPromptDelta(baselinePrompt, offPrompt);
  }

  if (!analyzeOnly) {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY missing — use --analyze-only with existing checkpoint or set key.");
      process.exit(1);
    }

    if (fresh && existsSync(CHECKPOINT_PATH)) {
      unlinkSync(CHECKPOINT_PATH);
      pairs = [];
      console.log("Cleared checkpoint (--fresh)");
    }

    const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
    const doneKeys = new Set(
      pairs.map((p) => pairKey(p.layerId, p.sceneId, p.runIndex))
    );

    const totalJobs = activeLayers.length * activeScenes.length * runsPerScene;
    let done = pairs.length;

    for (const layer of activeLayers) {
      for (const scene of activeScenes) {
        const { systemOn, userContent, history } = await assembleBaseline(scene);
        const systemOff = await assembleLayerOff(scene, layer.id);

        for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
          const key = pairKey(layer.id, scene.id, runIndex);
          if (doneKeys.has(key)) continue;

          console.log(`[${++done}/${totalJobs}] ${layer.id} · ${scene.id} · run ${runIndex + 1}`);

          const [textOn, textOff] = await Promise.all([
            generateSample(callOpenRouterCompletion, model, systemOn, history, userContent),
            generateSample(callOpenRouterCompletion, model, systemOff, history, userContent),
          ]);

          pairs.push({
            layerId: layer.id,
            sceneId: scene.id,
            runIndex,
            before: { text: textOn, metrics: analyzeStyleContribution(textOn) },
            after: { text: textOff, metrics: analyzeStyleContribution(textOff) },
          });

          writeFileSync(
            CHECKPOINT_PATH,
            JSON.stringify({ model, temperature: TEMPERATURE, runsPerScene, pairs }, null, 2),
            "utf8"
          );
          doneKeys.add(key);
        }
      }
    }
  } else if (pairs.length === 0) {
    console.error("--analyze-only: no checkpoint at", CHECKPOINT_PATH);
    process.exit(1);
  }

  const ranking = buildRanking(pairs, promptDeltas, activeLayers);

  const result = {
    generatedAt: new Date().toISOString(),
    auditOnly: true,
    model,
    temperature: TEMPERATURE,
    runsPerScene,
    sceneIds: activeScenes.map((s) => s.id),
    layerIds: activeLayers.map((l) => l.id),
    samplePairs: pairs.length,
    promptCharsRemoved: promptDeltas,
    contributionMatrix: ranking.map((r) => ({
      layerId: r.layerId,
      label: r.label,
      roiScore: r.roiScore,
      priority: r.priority,
      risk: r.risk,
      interactions: r.interactions,
      cells: r.cells,
    })),
    roiRanking: ranking.map((r) => ({
      priority: r.priority,
      layerId: r.layerId,
      label: r.label,
      roiScore: r.roiScore,
      risk: r.risk,
      overallHumanContribution: r.overallHumanContribution,
      topMetricDrivers: r.topMetricDrivers,
    })),
    pairs: pairs.map((p) => ({
      layerId: p.layerId,
      sceneId: p.sceneId,
      runIndex: p.runIndex,
      before: p.before.metrics,
      after: p.after.metrics,
    })),
  };

  writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2), "utf8");
  writeSummary(ranking, {
    samplePairs: pairs.length,
    runsPerScene,
    sceneCount: activeScenes.length,
    layerCount: activeLayers.length,
    model,
  });

  console.log(`\nWrote ${RESULT_JSON}`);
  console.log(`Wrote ${RESULT_SUMMARY}`);
  console.log("\nTop 3 ROI drivers:");
  for (const r of ranking.slice(0, 3)) {
    console.log(
      `  P${r.priority} ${r.label} — ROI=${r.roiScore}, risk=${r.risk}, overall Δ=${r.overallHumanContribution}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
