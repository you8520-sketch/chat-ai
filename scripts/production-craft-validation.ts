import "./lib/server-only-mock";

/**
 * Step 1.9b — Production Craft Validation (impact screening)
 *
 * Measures output impact when each craft candidate is OFF in production prompts.
 * Does NOT modify src rules — harness-only prompt stripping.
 *
 * Workflow:
 *   1. Screening (default): --runs=1 → 6×4×1 = 24 paired jobs → 48 API calls
 *   2. Re-validation: Medium+ candidates only with --runs=3
 *   3. Final stats: --runs=5 only when statistically required
 *
 * Usage:
 *   npx tsx scripts/production-craft-validation.ts --diff-only
 *   npx tsx scripts/production-craft-validation.ts --fresh
 *   npx tsx scripts/production-craft-validation.ts --revalidate --runs=1 --scene=horror --fresh
 *   npx tsx scripts/production-craft-validation.ts --candidates=M-04,M-09 --runs=3 --fresh
 *   npx tsx scripts/production-craft-validation.ts --analyze-only
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  CRAFT_CANDIDATES,
  applyCandidateOff,
  promptDiffSummary,
  type CraftCandidateId,
} from "./lib/production-craft-candidates";
import {
  PRODUCTION_VALIDATION_SCENES,
  buildProductionContextForScene,
} from "./lib/production-prompt-fixture";
import {
  analyzeProductionOutput,
  PRODUCTION_METRIC_LABELS,
  type ProductionOutputMetrics,
} from "./lib/production-output-metrics";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

const TEMPERATURE = 0.85;
/** Step 1.9b screening default — use --runs=3 for Medium+ re-validation, --runs=5 only for final stats */
const DEFAULT_RUNS = 1;
const PAIRED_SIDES = 2;

function computeRunPlan(opts: {
  candidateCount: number;
  sceneCount: number;
  runsPerScene: number;
}): {
  pairedJobs: number;
  totalApiCalls: number;
} {
  const pairedJobs = opts.candidateCount * opts.sceneCount * opts.runsPerScene;
  return { pairedJobs, totalApiCalls: pairedJobs * PAIRED_SIDES };
}

function printRunPlan(opts: {
  candidateCount: number;
  candidateIds: string[];
  sceneCount: number;
  runsPerScene: number;
  donePairedJobs: number;
}): void {
  const { pairedJobs, totalApiCalls } = computeRunPlan({
    candidateCount: opts.candidateCount,
    sceneCount: opts.sceneCount,
    runsPerScene: opts.runsPerScene,
  });
  const remainingPairedJobs = Math.max(0, pairedJobs - opts.donePairedJobs);
  const remainingApiCalls = remainingPairedJobs * PAIRED_SIDES;

  console.log("=== Step 1.9b Run Plan ===");
  console.log(`Candidates: ${opts.candidateCount}${opts.candidateIds.length ? ` (${opts.candidateIds.join(", ")})` : ""}`);
  console.log(`Scenes: ${opts.sceneCount}`);
  console.log(`Runs: ${opts.runsPerScene}`);
  console.log(`Before/After: ${PAIRED_SIDES}`);
  console.log(`Paired jobs (total): ${pairedJobs}`);
  console.log(`Total API calls: ${totalApiCalls}`);
  if (opts.donePairedJobs > 0) {
    console.log(`Already completed: ${opts.donePairedJobs} paired jobs (${opts.donePairedJobs * PAIRED_SIDES} API calls)`);
    console.log(`Remaining: ${remainingPairedJobs} paired jobs (${remainingApiCalls} API calls)`);
  }
  if (opts.runsPerScene === 1) {
    console.log("Mode: screening (--runs=1) — classify Low / Medium / High");
  } else if (opts.runsPerScene === 3) {
    console.log("Mode: re-validation (--runs=3) — Medium+ candidates");
  } else if (opts.runsPerScene >= 5) {
    console.log("Mode: final stats (--runs=5+) — use only when statistical confirmation is required");
  }
  console.log("");
}

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  version: "before" | "after";
  text: string;
  promptTokens: number;
  metrics: ProductionOutputMetrics;
};

type PairRecord = {
  candidateId: CraftCandidateId;
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

function parseCandidateArg(): CraftCandidateId | null {
  const arg = process.argv.find((a) => a.startsWith("--candidate="));
  if (!arg) return null;
  const id = arg.split("=")[1]?.split(",")[0] as CraftCandidateId;
  return CRAFT_CANDIDATES.some((c) => c.id === id) ? id : null;
}

function parseCandidatesList(): CraftCandidateId[] | null {
  const multi = process.argv.find((a) => a.startsWith("--candidates="));
  if (multi) {
    const ids = multi
      .split("=")[1]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) as CraftCandidateId[];
    const valid = ids.filter((id) => CRAFT_CANDIDATES.some((c) => c.id === id));
    return valid.length > 0 ? valid : null;
  }
  const single = parseCandidateArg();
  return single ? [single] : null;
}

/** Medium screening — load M-04, M-09 (Needs Validation) from prior screening result */
function loadRevalidationTargetsFromScreening(): CraftCandidateId[] | null {
  const path = join(process.cwd(), "output", "step19b-production-craft-validation.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      candidates?: { id: CraftCandidateId; screeningTier?: string; verdict?: string }[];
    };
    const targets = (data.candidates ?? [])
      .filter((c) => c.verdict === "Needs Validation" || c.screeningTier === "Medium")
      .map((c) => c.id);
    return targets.length > 0 ? targets : null;
  } catch {
    return null;
  }
}

function parseScenesFilter(): typeof PRODUCTION_VALIDATION_SCENES {
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

function pairKey(candidateId: string, sceneId: string, runIndex: number): string {
  return `${candidateId}#${sceneId}#${runIndex}`;
}

async function buildProductionPrompts(): Promise<{
  buildContext: typeof import("@/services/contextBuilder").buildContext;
}> {
  const { buildContext } = await import("@/services/contextBuilder");
  return { buildContext };
}

async function assembleTurn(scene: (typeof PRODUCTION_VALIDATION_SCENES)[number]): Promise<{
  systemBefore: string;
  userContent: string;
  history: { role: "user" | "assistant"; content: string }[];
}> {
  const { buildContext } = await buildProductionPrompts();
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  return { systemBefore: built.systemPrompt, userContent, history };
}

async function printAllDiffs(): Promise<void> {
  const scene = PRODUCTION_VALIDATION_SCENES[0];
  const { systemBefore } = await assembleTurn(scene);
  const outDir = join(process.cwd(), "output", "step19b-prompt-diffs");
  mkdirSync(outDir, { recursive: true });

  console.log("=== Step 1.9b Prompt Diffs (horror scene baseline) ===\n");
  console.log(`Production system (craft ON): ${systemBefore.length} chars, ~${estimateTokens(systemBefore)} tok\n`);

  for (const cand of CRAFT_CANDIDATES) {
    const systemAfter = applyCandidateOff(systemBefore, cand.id);
    const diff = promptDiffSummary(systemBefore, systemAfter);
    const path = join(outDir, `${cand.id}-prompt-diff.txt`);
    const body = [
      `# ${cand.id} — ${cand.label}`,
      `Source: ${cand.source} → SoT: ${cand.correctSoT}`,
      "",
      "## Token",
      `Before: ${diff.beforeChars} chars (~${estimateTokens(systemBefore)} tok)`,
      `After:  ${diff.afterChars} chars (~${estimateTokens(systemAfter)} tok)`,
      `Δ:      ${diff.deltaChars} chars`,
      "",
      "## 삭제 (candidate OFF)",
      ...cand.removedLines.map((l) => `- ${l}`),
      "",
      "## 유지",
      ...cand.keptLines.map((l) => `- ${l}`),
      "",
      "## 이동",
      "- (none — measurement only; no migration applied)",
      "",
      "## Removed from assembled prompt (line diff)",
      ...diff.removedSnippets.map((l) => `- ${l}`),
    ].join("\n");
    writeFileSync(path, body, "utf8");
    console.log(`${cand.id}: ${diff.deltaChars} chars removed → ${path}`);
  }
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
        requestKind: "production-craft-validation",
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

function buildReports(
  pairs: PairRecord[],
  metricKeys: (keyof ProductionOutputMetrics)[]
): PairedMetricReport[] {
  return metricKeys.map((key) => {
    const meta = PRODUCTION_METRIC_LABELS[key] ?? { label: key, higherIsBetter: false };
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;

    for (const pair of pairs) {
      const b = pair.before.metrics[key] as number;
      const a = pair.after.metrics[key] as number;
      beforeValues.push(b);
      afterValues.push(a);
      const imp = meta.higherIsBetter ? a - b : b - a;
      improvements.push(imp);
      if (b === a) ties++;
      else if (meta.higherIsBetter ? a > b : a < b) wins++;
    }

    return buildPairedMetricReport({
      metricKey: key,
      label: meta.label,
      higherIsBetter: meta.higherIsBetter,
      beforeValues,
      afterValues,
      improvements,
      wins,
      ties,
    });
  });
}

type ImpactLevel = "None" | "Small" | "Medium" | "High";

/** Screening tier for Step 1.9b (Low / Medium / High) */
function screeningTier(level: ImpactLevel): "Low" | "Medium" | "High" {
  if (level === "High") return "High";
  if (level === "Medium") return "Medium";
  return "Low";
}

function classifyImpact(reports: PairedMetricReport[]): {
  level: ImpactLevel;
  significantMetrics: string[];
  meanAbsDeltaPct: number;
} {
  const sig = reports.filter((r) => r.significantAt95);
  const charReport = reports.find((r) => r.metricKey === "charLength");
  const charDeltaPct =
    charReport && charReport.before.mean > 0
      ? Math.abs(charReport.improvement.mean) / charReport.before.mean
      : 0;

  const meanAbsDeltaPct =
    reports.reduce((s, r) => {
      const base = Math.abs(r.before.mean) || 1;
      return s + Math.abs(r.improvement.mean) / base;
    }, 0) / reports.length;

  let level: ImpactLevel = "None";
  if (sig.length >= 3 || charDeltaPct >= 0.12) level = "High";
  else if (sig.length >= 2 || charDeltaPct >= 0.06 || meanAbsDeltaPct >= 0.08) level = "Medium";
  else if (sig.length >= 1 || charDeltaPct >= 0.03 || meanAbsDeltaPct >= 0.04) level = "Small";

  return {
    level,
    significantMetrics: sig.map((r) => r.label),
    meanAbsDeltaPct: Math.round(meanAbsDeltaPct * 1000) / 1000,
  };
}

type MigrationVerdict = "Safe" | "Needs Validation" | "Keep";

function recommendVerdict(
  impact: ImpactLevel,
  significantMetrics: string[]
): { sotMovable: boolean; verdict: MigrationVerdict; recommendation: string } {
  if (impact === "None" || impact === "Small") {
    return {
      sotMovable: true,
      verdict: "Safe",
      recommendation: "DELETE from source — PROSE/bundle SoT likely sufficient",
    };
  }
  if (impact === "Medium") {
    return {
      sotMovable: true,
      verdict: "Needs Validation",
      recommendation: `Prod harness + spot-check (${significantMetrics.join(", ") || "metrics"}) before DELETE`,
    };
  }
  return {
    sotMovable: false,
    verdict: "Keep",
    recommendation: "Retain in LENGTH/HANDOFF/GENRE until PROSE compensates — high driver",
  };
}

async function main() {
  const diffOnly = process.argv.includes("--diff-only");
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const runsPerScene = parseRunsArg();
  const revalidate = process.argv.includes("--revalidate");
  const explicitCandidates = parseCandidatesList();
  const screeningTargets = revalidate ? loadRevalidationTargetsFromScreening() : null;
  const candidateIds = explicitCandidates ?? screeningTargets;
  const candidates = candidateIds
    ? CRAFT_CANDIDATES.filter((c) => candidateIds.includes(c.id))
    : CRAFT_CANDIDATES;
  const activeScenes = parseScenesFilter();

  const isRevalidation = revalidate || runsPerScene > 1;
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(
    outDir,
    isRevalidation ? "step19b-revalidation-checkpoint.json" : "step19b-production-craft-checkpoint.json"
  );
  const resultPath = join(
    outDir,
    isRevalidation ? "step19b-revalidation-results.json" : "step19b-production-craft-validation.json"
  );

  if (revalidate && candidates.length === 0) {
    console.error("--revalidate: no Needs Validation targets in screening result (run screening first)");
    process.exit(1);
  }

  if (diffOnly) {
    await printAllDiffs();
    return;
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

    const existing = fresh ? null : (JSON.parse(
      existsSync(checkpointPath) ? readFileSync(checkpointPath, "utf8") : "null"
    ) as Checkpoint | null);

    checkpoint = {
      model,
      temperature: TEMPERATURE,
      runsPerScene,
      pairs: existing?.pairs ?? [],
    };

    const doneKeys = new Set(
      checkpoint.pairs.map((p) => pairKey(p.candidateId, p.sceneId, p.runIndex))
    );

    const { pairedJobs: totalPairedJobs, totalApiCalls } = computeRunPlan({
      candidateCount: candidates.length,
      sceneCount: activeScenes.length,
      runsPerScene,
    });

    printRunPlan({
      candidateCount: candidates.length,
      candidateIds: candidates.map((c) => c.id),
      sceneCount: activeScenes.length,
      runsPerScene,
      donePairedJobs: doneKeys.size,
    });

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

    let completedPairedJobs = doneKeys.size;
    let completedApiCalls = completedPairedJobs * PAIRED_SIDES;

    for (const cand of candidates) {
      for (const scene of activeScenes) {
        const { systemBefore, userContent, history } = await assembleTurn(scene);
        const systemAfter = applyCandidateOff(systemBefore, cand.id);

        for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
          const key = pairKey(cand.id, scene.id, runIndex);
          if (doneKeys.has(key)) continue;

          completedPairedJobs++;
          console.log(
            [
              `[${completedPairedJobs}/${totalPairedJobs}]`,
              `Candidate: ${cand.id}`,
              `Scene: ${scene.label} (${scene.id})`,
              `Run: ${runIndex + 1}/${runsPerScene}`,
              `Paired job: Before+After (${PAIRED_SIDES} API)`,
              `API progress: ${completedApiCalls + 1}-${completedApiCalls + PAIRED_SIDES}/${totalApiCalls}`,
            ].join(" | ")
          );

          const beforeText = await generateSample(
            callOpenRouterCompletion,
            model,
            systemBefore,
            history,
            userContent
          );
          completedApiCalls++;

          const afterText = await generateSample(
            callOpenRouterCompletion,
            model,
            systemAfter,
            history,
            userContent
          );
          completedApiCalls++;

          checkpoint.pairs.push({
            candidateId: cand.id,
            sceneId: scene.id,
            sceneLabel: scene.label,
            runIndex,
            before: {
              sceneId: scene.id,
              runIndex,
              version: "before",
              text: beforeText,
              promptTokens: estimateTokens(systemBefore),
              metrics: analyzeProductionOutput(beforeText),
            },
            after: {
              sceneId: scene.id,
              runIndex,
              version: "after",
              text: afterText,
              promptTokens: estimateTokens(systemAfter),
              metrics: analyzeProductionOutput(afterText),
            },
          });
          doneKeys.add(key);
          writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
        }
      }
    }
  }

  await printAllDiffs();

  const metricKeys = Object.keys(PRODUCTION_METRIC_LABELS) as (keyof ProductionOutputMetrics)[];
  const candidateResults = candidates.map((cand) => {
    const pairs = checkpoint.pairs.filter((p) => p.candidateId === cand.id);
    const reports = buildReports(pairs, metricKeys);
    const impact = classifyImpact(reports);
    const rec = recommendVerdict(impact.level, impact.significantMetrics);
    const promptTokDelta =
      pairs.length > 0 ? pairs[0].after.promptTokens - pairs[0].before.promptTokens : 0;

    const expectedPairsPerCandidate = activeScenes.length * checkpoint.runsPerScene;

    return {
      id: cand.id,
      label: cand.label,
      source: cand.source,
      correctSoT: cand.correctSoT,
      pairedN: pairs.length,
      promptTokenDelta: promptTokDelta,
      impact: impact.level,
      screeningTier: screeningTier(impact.level),
      significantMetrics: impact.significantMetrics,
      meanAbsDeltaPct: impact.meanAbsDeltaPct,
      sotMovable: rec.sotMovable,
      verdict: rec.verdict,
      recommendation: rec.recommendation,
      metrics: reports,
      regressionPass: pairs.length >= expectedPairsPerCandidate,
    };
  });

  const result = {
    test: isRevalidation ? "step19b-revalidation" : "step19b-production-craft-validation",
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    scenes: activeScenes.map((s) => s.id),
    candidates: candidateResults,
    pairs: checkpoint.pairs,
  };

  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Step 1.9b Production Craft Validation ===\n");
  console.log(
    "| Candidate | Screening | Detail | SoT 이동 | Pairs | Recommendation | Verdict |"
  );
  console.log("|-----------|-----------|--------|----------|-------|----------------|---------|");
  for (const c of candidateResults) {
    const reg = c.regressionPass ? `${c.pairedN} ✓` : `${c.pairedN} partial`;
    console.log(
      `| ${c.id} | ${c.screeningTier} | ${c.impact} | ${c.sotMovable ? "Yes" : "No"} | ${reg} | ${c.recommendation.slice(0, 36)}… | ${c.verdict} |`
    );
  }

  const mediumPlusCandidates = candidateResults.filter(
    (c) => c.screeningTier === "Medium" || c.screeningTier === "High"
  );
  if (checkpoint.runsPerScene === 1 && mediumPlusCandidates.length > 0) {
    console.log("\n=== Medium+ → re-validate with --runs=3 ===");
    for (const c of mediumPlusCandidates) {
      console.log(
        `  npm.cmd exec tsx scripts/production-craft-validation.ts -- --candidate=${c.id} --runs=3 --fresh`
      );
    }
  }

  console.log("\n=== Metric detail (craft ON vs OFF) ===\n");
  for (const c of candidateResults) {
    console.log(`--- ${c.id} (${c.impact}) ---`);
    for (const r of c.metrics) {
      const sig = r.significantAt95 ? "*" : "";
      console.log(
        `  ${r.label}${sig}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} p=${r.pairedTPValue}`
      );
    }
    console.log(`  prompt tok Δ: ${c.promptTokenDelta}\n`);
  }

  console.log(`Wrote ${resultPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
