import "./lib/server-only-mock";

/**
 * Step 4.1 — Blueprint harness A/B (2-stage validation)
 *
 * Stage 1 — Screening (default): 4 scenes × 3 runs = 12 pairs = 24 API calls
 *   Primary metrics only: humanProxyOverall, webnovelLikeness, immersion, sentenceRhythm
 *   Early exit when Blueprint is clearly ahead or behind.
 *
 * Stage 2 — Full validation (only if ambiguous): 4 scenes × 10 runs = 40 pairs
 *   Run with --full-validation after screening returns AMBIGUOUS.
 *
 * Usage:
 *   npx tsx scripts/step41-blueprint-harness-ab.ts --diff-only
 *   npx tsx scripts/step41-blueprint-harness-ab.ts --fresh              # screening
 *   npx tsx scripts/step41-blueprint-harness-ab.ts --full-validation   # expand after ambiguous
 *   npx tsx scripts/step41-blueprint-harness-ab.ts --analyze-only
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  PRODUCTION_VALIDATION_SCENES,
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import {
  applyBlueprintArchitecture,
  blueprintPromptDiffSummary,
} from "./lib/blueprint-prompt-vnext";
import {
  evaluateStyleQuality,
  STYLE_QUALITY_CRITERIA,
  SCREENING_STYLE_CRITERIA,
  FULL_REPORT_CRITERIA,
  type StyleQualityCriterion,
  type StyleQualityScores,
} from "./lib/style-quality-evaluation";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TEMPERATURE = 0.85;
const SCREENING_RUNS_PER_SCENE = 3;
const FULL_RUNS_PER_SCENE = 10;
const PAIRED_SIDES = 2;
/** Minimum pairs before screening early-exit is allowed */
const SCREENING_EARLY_EXIT_MIN_PAIRS = 6;

export type ScreeningOutcome = "blueprint_clear" | "production_clear" | "ambiguous" | "insufficient";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

function parseScenesFilter(): ProductionValidationScene[] {
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

function pairKey(sceneId: string, runIndex: number): string {
  return `${sceneId}#${runIndex}`;
}

async function assembleTurn(scene: ProductionValidationScene): Promise<{
  systemBefore: string;
  systemBlueprint: string;
  userContent: string;
  history: { role: "user" | "assistant"; content: string }[];
}> {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  const systemBefore = built.systemPrompt;
  const systemBlueprint = applyBlueprintArchitecture(systemBefore, { genres: scene.genres });
  return { systemBefore, systemBlueprint, userContent, history };
}

async function printPromptDiff(): Promise<void> {
  const scene = PRODUCTION_VALIDATION_SCENES[0]!;
  const { systemBefore, systemBlueprint } = await assembleTurn(scene);
  const diff = blueprintPromptDiffSummary(systemBefore, systemBlueprint);
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "step41-blueprint-prompt-diff.txt");

  const body = [
    "# Step 4.1 — Production vs Blueprint Prompt",
    "",
    `Scene: ${scene.label} (${scene.id})`,
    "",
    "## Token estimate",
    `Before: ${diff.beforeChars} chars (~${estimateTokens(systemBefore)} tok)`,
    `Blueprint: ${diff.afterChars} chars (~${estimateTokens(systemBlueprint)} tok)`,
    `Δ: ${diff.deltaChars} chars`,
    "",
    "## Removed from production (→ FLOW or dropped)",
    ...diff.removedSections.map((s) => `- ${s}`),
    "",
    "## Blueprint additions",
    "- [GENERATION PROCESS — BEAT FLOW] + [SCENE MODE]",
    "- [STYLE — content constraints only]",
    "- [LENGTH CONTROL] numeric + loop count only",
    "- [SCENE MODE SELECT] (ex-genre_tone)",
    "- <TURN_HANDOFF> floor gate only",
    "- [DIALOGUE INTEGRITY] (ex-DNR)",
    "",
    "---",
    "",
    "## Full blueprint system prompt",
    "",
    systemBlueprint,
  ].join("\n");

  writeFileSync(path, body, "utf8");
  console.log("=== Step 4.1 Prompt Diff ===");
  console.log(`Production: ~${estimateTokens(systemBefore)} tok`);
  console.log(`Blueprint:  ~${estimateTokens(systemBlueprint)} tok (Δ ${diff.deltaChars} chars)`);
  console.log(`Removed: ${diff.removedSections.join(", ")}`);
  console.log(`Wrote ${path}`);
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
        requestKind: "step41-blueprint-harness-ab",
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

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  version: "before" | "blueprint";
  text: string;
  promptTokens: number;
  quality: StyleQualityScores;
  charCount: number;
  sideMetrics: ReturnType<typeof evaluateStyleQuality>["sideMetrics"];
};

type PairRecord = {
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: SampleRecord;
  blueprint: SampleRecord;
};

type ValidationPhase = "screening" | "full";

type Checkpoint = {
  phase: ValidationPhase;
  model: string;
  temperature: number;
  runsPerScene: number;
  pairs: PairRecord[];
  screeningOutcome?: ScreeningOutcome;
  earlyExit?: boolean;
};

function buildQualityReports(
  pairs: PairRecord[],
  criteria: StyleQualityCriterion[]
): PairedMetricReport[] {
  return criteria.map((criterion) => {
    const meta = STYLE_QUALITY_CRITERIA.find((c) => c.id === criterion)!;
    const beforeValues: number[] = [];
    const blueprintValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;

    for (const pair of pairs) {
      const b = pair.before.quality[criterion];
      const a = pair.blueprint.quality[criterion];
      beforeValues.push(b);
      blueprintValues.push(a);
      improvements.push(a - b);
      if (b === a) ties++;
      else if (a > b) wins++;
    }

    return buildPairedMetricReport({
      metricKey: criterion,
      label: meta.labelKo,
      higherIsBetter: true,
      beforeValues,
      afterValues: blueprintValues,
      improvements,
      wins,
      ties,
    });
  });
}

export function evaluateScreeningOutcome(
  pairs: PairRecord[],
  opts?: { minPairs?: number; maxPairs?: number }
): ScreeningOutcome {
  const minPairs = opts?.minPairs ?? SCREENING_EARLY_EXIT_MIN_PAIRS;
  const maxPairs = opts?.maxPairs ?? PRODUCTION_VALIDATION_SCENES.length * SCREENING_RUNS_PER_SCENE;

  if (pairs.length < 4) return "insufficient";

  const reports = buildQualityReports(pairs, SCREENING_STYLE_CRITERIA);
  const human = reports.find((r) => r.metricKey === "humanProxyOverall")!;

  const ahead = reports.filter((r) => r.improvement.mean >= 0.15 && r.winRate >= 0.58);
  const behind = reports.filter((r) => r.improvement.mean <= -0.15 && r.winRate <= 0.42);

  const canDecide = pairs.length >= minPairs || pairs.length >= maxPairs;

  if (canDecide) {
    if (
      ahead.length >= 4 &&
      human.improvement.mean >= 0.25 &&
      human.winRate >= 0.6
    ) {
      return "blueprint_clear";
    }
    if (
      behind.length >= 4 &&
      human.improvement.mean <= -0.25 &&
      human.winRate <= 0.4
    ) {
      return "production_clear";
    }

    if (pairs.length >= maxPairs) {
      if (ahead.length >= 3 && human.improvement.mean > 0 && human.winRate >= 0.55) {
        return "blueprint_clear";
      }
      if (behind.length >= 3 && human.improvement.mean < 0 && human.winRate <= 0.45) {
        return "production_clear";
      }
      return "ambiguous";
    }

    if (pairs.length >= minPairs) {
      if (ahead.length === 4 && human.improvement.mean >= 0.35 && human.winRate >= 0.67) {
        return "blueprint_clear";
      }
      if (behind.length === 4 && human.improvement.mean <= -0.35 && human.winRate <= 0.33) {
        return "production_clear";
      }
    }
  }

  if (pairs.length >= maxPairs) return "ambiguous";
  return "insufficient";
}

function gateVerdict(
  screeningReports: PairedMetricReport[],
  outcome: ScreeningOutcome,
  phase: ValidationPhase
): string {
  if (phase === "screening") {
    if (outcome === "blueprint_clear") {
      return "SCREENING: BLUEPRINT CLEARLY AHEAD — production rollout review (no full validation needed)";
    }
    if (outcome === "production_clear") {
      return "SCREENING: PRODUCTION CLEARLY AHEAD — do not apply Blueprint";
    }
    if (outcome === "ambiguous") {
      return "SCREENING: AMBIGUOUS — run --full-validation (4×10 runs)";
    }
    return "SCREENING: INCOMPLETE — finish screening run";
  }

  const human = screeningReports.find((r) => r.metricKey === "humanProxyOverall");
  if (!human || human.pairedN < 20) {
    return "FULL: INSUFFICIENT DATA";
  }
  const ahead = screeningReports.filter(
    (r) => r.improvement.mean > 0 && r.winRate >= 0.55
  ).length;
  if (human.improvement.mean > 0 && human.winRate >= 0.55 && ahead >= 3) {
    return "FULL: BLUEPRINT AHEAD — consider production rollout review";
  }
  if (human.improvement.mean < 0 && human.winRate <= 0.45) {
    return "FULL: PRODUCTION AHEAD — do not apply Blueprint";
  }
  return "FULL: MIXED — human rater review required";
}

function buildSummaryMarkdown(opts: {
  phase: ValidationPhase;
  model: string;
  runsPerScene: number;
  scenes: string[];
  pairs: PairRecord[];
  screeningReports: PairedMetricReport[];
  fullReports: PairedMetricReport[];
  outcome: ScreeningOutcome;
  gateVerdict: string;
  earlyExit?: boolean;
}): string {
  const human = opts.screeningReports.find((r) => r.metricKey === "humanProxyOverall");

  return [
    "# Step 4.1 — Blueprint Harness A/B",
    "",
    "> **평가 기준:** 사람이 읽었을 때 더 좋은 문체 (human proxy 우선).",
    "> Screening: 4 metrics only. gestureRepeat / touchShare / hook freq **NOT gate**.",
    "",
    "## Run config",
    "",
    `- Phase: **${opts.phase}**${opts.earlyExit ? " (early exit)" : ""}`,
    `- Model: \`${opts.model}\``,
    `- Temperature: ${TEMPERATURE}`,
    `- Scenes: ${opts.scenes.join(", ")}`,
    `- Runs/scene: ${opts.runsPerScene}`,
    `- Paired samples: ${opts.pairs.length} (${opts.pairs.length * PAIRED_SIDES} generations)`,
    `- Screening outcome: \`${opts.outcome}\``,
    "",
    "## Screening metrics (gate)",
    "",
    "| Criterion | Before | Blueprint | Δ | Win rate | Verdict |",
    "|-----------|--------|-----------|---|----------|---------|",
    ...opts.screeningReports.map((r) => {
      return `| ${r.label} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% | ${r.verdict} |`;
    }),
    "",
    opts.phase === "full"
      ? [
          "## Full validation — additional metrics (informational)",
          "",
          "| Criterion | Before | Blueprint | Δ | Win rate |",
          "|-----------|--------|-----------|---|----------|",
          ...opts.fullReports
            .filter((r) => !SCREENING_STYLE_CRITERIA.includes(r.metricKey as StyleQualityCriterion))
            .map(
              (r) =>
                `| ${r.label} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% |`
            ),
          "",
        ].join("\n")
      : "",
    "## Gate",
    "",
    human
      ? `- humanProxyOverall: before=${human.before.mean} blueprint=${human.after.mean} Δ=${human.improvement.mean} win=${(human.winRate * 100).toFixed(0)}%`
      : "",
    "",
    `**${opts.gateVerdict}**`,
    "",
    opts.outcome === "ambiguous" && opts.phase === "screening"
      ? "```\nnpm.cmd exec tsx scripts/step41-blueprint-harness-ab.ts -- --full-validation\n```"
      : "",
    "",
    "Full texts: `output/step41-blueprint-ab.json`",
  ].join("\n");
}

async function main() {
  const diffOnly = process.argv.includes("--diff-only");
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const fullValidation = process.argv.includes("--full-validation");
  const activeScenes = parseScenesFilter();

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step41-blueprint-ab-checkpoint.json");
  const resultPath = join(outDir, "step41-blueprint-ab.json");
  const summaryPath = join(outDir, "step41-blueprint-ab-summary.md");

  if (diffOnly) {
    await printPromptDiff();
    return;
  }

  const phase: ValidationPhase = fullValidation ? "full" : "screening";
  const targetRunsPerScene =
    phase === "full" ? FULL_RUNS_PER_SCENE : SCREENING_RUNS_PER_SCENE;

  if (fullValidation && !fresh && !existsSync(checkpointPath)) {
    console.error("--full-validation requires prior screening checkpoint (or use --fresh for standalone full run)");
    process.exit(1);
  }

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("Cleared checkpoint (--fresh)");
  }

  let checkpoint: Checkpoint;

  if (analyzeOnly) {
    if (!existsSync(checkpointPath)) {
      console.error("No checkpoint — run without --analyze-only first");
      process.exit(1);
    }
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
  } else {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY required (or use --diff-only)");
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

    if (fullValidation && existing && !fresh) {
      if (existing.screeningOutcome !== "ambiguous" && existing.phase === "screening") {
        const priorOutcome = evaluateScreeningOutcome(existing.pairs);
        if (priorOutcome === "blueprint_clear" || priorOutcome === "production_clear") {
          console.error(
            `Screening was ${priorOutcome} — full validation not required. Use --fresh to force full run.`
          );
          process.exit(1);
        }
      }
    }

    checkpoint = {
      phase,
      model,
      temperature: TEMPERATURE,
      runsPerScene: targetRunsPerScene,
      pairs: fullValidation && existing && !fresh ? existing.pairs : (existing?.pairs ?? []),
      screeningOutcome: existing?.screeningOutcome,
      earlyExit: existing?.earlyExit,
    };

    const doneKeys = new Set(checkpoint.pairs.map((p) => pairKey(p.sceneId, p.runIndex)));
    const totalPairs = activeScenes.length * targetRunsPerScene;
    const totalApiCalls = totalPairs * PAIRED_SIDES;

    console.log(`=== Step 4.1 ${phase.toUpperCase()} ===`);
    console.log(`Scenes: ${activeScenes.length} (${activeScenes.map((s) => s.id).join(", ")})`);
    console.log(`Runs/scene: ${targetRunsPerScene}`);
    console.log(`Paired jobs: ${totalPairs} → ${totalApiCalls} API calls`);
    console.log(`Completed: ${doneKeys.size}/${totalPairs}`);
    console.log(
      phase === "screening"
        ? "Metrics: humanProxyOverall, webnovelLikeness, immersion, sentenceRhythm"
        : "Metrics: screening gate + repetition/infoDensity (informational)"
    );
    if (phase === "screening") {
      console.log(`Early exit allowed after ${SCREENING_EARLY_EXIT_MIN_PAIRS} pairs if clearly ahead/behind\n`);
    } else {
      console.log("");
    }

    if (
      existing &&
      !fullValidation &&
      existing.phase === "full" &&
      existing.pairs.length > 0 &&
      !fresh
    ) {
      console.error("Checkpoint is full-validation phase. Use --full-validation or --fresh.");
      process.exit(1);
    }

    let completedApiCalls = doneKeys.size * PAIRED_SIDES;
    let earlyExit = false;

    sceneLoop: for (const scene of activeScenes) {
      const { systemBefore, systemBlueprint, userContent, history } = await assembleTurn(scene);

      for (let runIndex = 0; runIndex < targetRunsPerScene; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (doneKeys.has(key)) continue;

        console.log(
          `[${doneKeys.size + 1}/${totalPairs}] ${scene.label} run ${runIndex + 1}/${targetRunsPerScene} | API ${completedApiCalls + 1}-${completedApiCalls + PAIRED_SIDES}/${totalApiCalls}`
        );

        const beforeText = await generateSample(
          callOpenRouterCompletion,
          model,
          systemBefore,
          history,
          userContent
        );
        completedApiCalls++;
        const beforeQ = evaluateStyleQuality(beforeText);

        const blueprintText = await generateSample(
          callOpenRouterCompletion,
          model,
          systemBlueprint,
          history,
          userContent
        );
        completedApiCalls++;
        const blueprintQ = evaluateStyleQuality(blueprintText);

        checkpoint.pairs.push({
          sceneId: scene.id,
          sceneLabel: scene.label,
          runIndex,
          before: {
            sceneId: scene.id,
            runIndex,
            version: "before",
            text: beforeText,
            promptTokens: estimateTokens(systemBefore),
            quality: beforeQ.scores,
            charCount: beforeQ.charCount,
            sideMetrics: beforeQ.sideMetrics,
          },
          blueprint: {
            sceneId: scene.id,
            runIndex,
            version: "blueprint",
            text: blueprintText,
            promptTokens: estimateTokens(systemBlueprint),
            quality: blueprintQ.scores,
            charCount: blueprintQ.charCount,
            sideMetrics: blueprintQ.sideMetrics,
          },
        });
        doneKeys.add(key);

        if (phase === "screening") {
          const outcome = evaluateScreeningOutcome(checkpoint.pairs);
          checkpoint.screeningOutcome = outcome;

          if (outcome === "blueprint_clear" || outcome === "production_clear") {
            earlyExit = true;
            checkpoint.earlyExit = true;
            console.log(`\n>>> Screening early exit: ${outcome} (${checkpoint.pairs.length} pairs)\n`);
            writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
            break sceneLoop;
          }
        }

        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
      }
    }

    if (phase === "screening" && !earlyExit) {
      checkpoint.screeningOutcome = evaluateScreeningOutcome(checkpoint.pairs);
      writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
    }
  }

  const screeningReports = buildQualityReports(checkpoint.pairs, SCREENING_STYLE_CRITERIA);
  const fullReports = buildQualityReports(checkpoint.pairs, FULL_REPORT_CRITERIA);
  const outcome =
    checkpoint.screeningOutcome ??
    evaluateScreeningOutcome(checkpoint.pairs, {
      minPairs: 4,
      maxPairs: checkpoint.pairs.length,
    });
  const gate = gateVerdict(screeningReports, outcome, checkpoint.phase);

  const promptDelta =
    checkpoint.pairs.length > 0
      ? checkpoint.pairs[0]!.blueprint.promptTokens - checkpoint.pairs[0]!.before.promptTokens
      : 0;

  const result = {
    test: "step41-blueprint-harness-ab",
    phase: checkpoint.phase,
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    scenes: activeScenes.map((s) => s.id),
    screeningCriteria: SCREENING_STYLE_CRITERIA,
    screeningOutcome: outcome,
    earlyExit: checkpoint.earlyExit ?? false,
    evaluationFocus: "human-readable style quality (not structural adherence)",
    promptTokenDelta: promptDelta,
    gateVerdict: gate,
    screeningMetrics: screeningReports,
    fullMetrics: checkpoint.phase === "full" ? fullReports : undefined,
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  writeFileSync(
    summaryPath,
    buildSummaryMarkdown({
      phase: checkpoint.phase,
      model: checkpoint.model,
      runsPerScene: checkpoint.runsPerScene,
      scenes: activeScenes.map((s) => s.id),
      pairs: checkpoint.pairs,
      screeningReports,
      fullReports,
      outcome,
      gateVerdict: gate,
      earlyExit: checkpoint.earlyExit,
    }),
    "utf8"
  );

  console.log(`\n=== Step 4.1 ${checkpoint.phase.toUpperCase()} Results ===\n`);
  console.log("| Screening metric | Before | Blueprint | Δ | Win% |");
  console.log("|------------------|--------|-----------|---|------|");
  for (const r of screeningReports) {
    console.log(
      `| ${r.label} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% |`
    );
  }
  console.log(`\nOutcome: ${outcome}`);
  console.log(`Gate: ${gate}`);
  if (outcome === "ambiguous" && checkpoint.phase === "screening") {
    console.log("\nNext: npm.cmd exec tsx scripts/step41-blueprint-harness-ab.ts -- --full-validation");
  }
  console.log(`\nWrote ${resultPath}`);
  console.log(`Wrote ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
