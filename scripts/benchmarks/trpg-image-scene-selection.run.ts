#!/usr/bin/env node
/**
 * TRPG important-scene selection benchmark runner.
 * Manual execution only — never run provider calls in CI.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/benchmarks/trpg-image-scene-selection.run.ts
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { planChatImageScene } from "@/lib/chatImageScenePlanner";
import {
  BENCHMARK_DIR,
  FIXTURES_PATH,
  RESULTS_PATH,
  REVIEW_PACKET_PATH,
  buildAiArmFromPlan,
  buildFixtureResult,
  buildTrpgNarrationSceneMessages,
  evaluateCompatibilityProbe,
  loadFixtures,
  percentile,
  plannerConstants,
  renderReviewPacket,
  resolvedPlannerModels,
  summarizeInvocationCounts,
  type TrpgBenchmarkArmAi,
  type TrpgBenchmarkFixture,
  type TrpgBenchmarkFixtureResult,
  type TrpgBenchmarkResultsFile,
} from "./trpg-image-scene-selection.harness";

const PROBE_FIXTURE_IDS = ["F1", "F5"] as const;
const BENCHMARK_CHARACTER_NAME = "TRPG GM";
const BENCHMARK_PERSONA_NAME = "Party";

function gitSha(ref: string): string {
  return execSync(`git rev-parse ${ref}`, { encoding: "utf8" }).trim();
}

async function runAiPlannerOnce(
  fixture: TrpgBenchmarkFixture,
  models: ReturnType<typeof resolvedPlannerModels>
): Promise<TrpgBenchmarkArmAi> {
  const messages = buildTrpgNarrationSceneMessages(fixture.narration);
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let providerCostUsd: number | null = null;
  const started = Date.now();
  const result = await planChatImageScene({
    characterName: BENCHMARK_CHARACTER_NAME,
    personaName: BENCHMARK_PERSONA_NAME,
    messages,
    complete: async (opts) => {
      const { text, usage } = await callOpenRouterCompletion({
        system: opts.system,
        history: [{ role: "user", content: opts.prompt }],
        model: opts.model,
        temperature: 0.1,
        maxTokens: 2048,
        disableReasoning: true,
        requestKind: "background-chat-image-scene-brief",
        timeoutMs: 120_000,
      });
      inputTokens = usage.inputTokens ?? null;
      outputTokens = usage.outputTokens ?? null;
      providerCostUsd =
        usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null;
      return text;
    },
  });
  const latencyMs = Date.now() - started;
  return buildAiArmFromPlan({
    plan: result.plan,
    model: result.model,
    usedFallback: result.usedFallback,
    attempts: result.attempts,
    latencyMs,
    resolvedPrimaryModel: models.primary,
    resolvedFallbackModel: models.fallback,
    inputTokens,
    outputTokens,
    providerCostUsd,
  });
}

async function main(): Promise<void> {
  mkdirSync(BENCHMARK_DIR, { recursive: true });
  const fixturesFile = loadFixtures(FIXTURES_PATH);
  const fixtures = fixturesFile.fixtures;
  if (fixtures.length !== 10) {
    throw new Error(`Expected 10 fixtures, found ${fixtures.length}`);
  }

  const models = resolvedPlannerModels();
  const constants = plannerConstants();
  const aiByFixtureId = new Map<string, TrpgBenchmarkArmAi>();
  let invocations = 0;

  console.log("[benchmark] compatibility probe fixtures:", PROBE_FIXTURE_IDS.join(", "));
  for (const fixtureId of PROBE_FIXTURE_IDS) {
    const fixture = fixtures.find((row) => row.fixtureId === fixtureId);
    if (!fixture) throw new Error(`Missing probe fixture ${fixtureId}`);
    console.log(`[benchmark] AI planner ${fixtureId} ...`);
    const ai = await runAiPlannerOnce(fixture, models);
    aiByFixtureId.set(fixtureId, ai);
    invocations += 1;
  }

  const probeResults = PROBE_FIXTURE_IDS.map((fixtureId) => {
    const fixture = fixtures.find((row) => row.fixtureId === fixtureId)!;
    return buildFixtureResult(fixture, aiByFixtureId.get(fixtureId)!);
  });
  const compatibility = evaluateCompatibilityProbe(probeResults);
  console.log("[benchmark] compatibility:", compatibility.status, compatibility.checks);

  if (compatibility.status === "FAIL") {
    const partialResults: TrpgBenchmarkResultsFile = {
      version: 1,
      baseMainSha: gitSha("origin/main"),
      benchmarkHeadSha: gitSha("HEAD"),
      nodeVersion: process.version,
      resolvedPrimaryModel: models.primary,
      resolvedFallbackModel: models.fallback,
      scenePlanMaxProviderAttempts: constants.scenePlanMaxProviderAttempts,
      scenePlanRetryCount: constants.scenePlanRetryCount,
      compatibility: {
        status: "FAIL",
        probeFixtureIds: [...PROBE_FIXTURE_IDS],
        checks: compatibility.checks,
      },
      invocationCounts: summarizeInvocationCounts(probeResults, invocations),
      latenciesMs: probeResults.map((row) => row.aiPlanner?.latencyMs ?? 0),
      fixtures: probeResults,
    };
    writeFileSync(RESULTS_PATH, `${JSON.stringify(partialResults, null, 2)}\n`, "utf8");
    writeFileSync(REVIEW_PACKET_PATH, `${renderReviewPacket(partialResults)}\n`, "utf8");
    console.log("[benchmark] compatibility FAIL — partial results written; remaining fixtures skipped.");
    return;
  }

  for (const fixture of fixtures) {
    if (aiByFixtureId.has(fixture.fixtureId)) continue;
    console.log(`[benchmark] AI planner ${fixture.fixtureId} ...`);
    const ai = await runAiPlannerOnce(fixture, models);
    aiByFixtureId.set(fixture.fixtureId, ai);
    invocations += 1;
  }

  if (invocations > 10) {
    throw new Error(`planChatImageScene invocations exceeded budget: ${invocations}`);
  }

  const fixtureResults: TrpgBenchmarkFixtureResult[] = fixtures.map((fixture) =>
    buildFixtureResult(fixture, aiByFixtureId.get(fixture.fixtureId)!)
  );

  const results: TrpgBenchmarkResultsFile = {
    version: 1,
    baseMainSha: gitSha("origin/main"),
    benchmarkHeadSha: gitSha("HEAD"),
    nodeVersion: process.version,
    resolvedPrimaryModel: models.primary,
    resolvedFallbackModel: models.fallback,
    scenePlanMaxProviderAttempts: constants.scenePlanMaxProviderAttempts,
    scenePlanRetryCount: constants.scenePlanRetryCount,
    compatibility: {
      status: "PASS",
      probeFixtureIds: [...PROBE_FIXTURE_IDS],
      checks: compatibility.checks,
    },
    invocationCounts: summarizeInvocationCounts(fixtureResults, invocations),
    latenciesMs: fixtureResults.map((row) => row.aiPlanner?.latencyMs ?? 0),
    fixtures: fixtureResults,
  };

  writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  writeFileSync(REVIEW_PACKET_PATH, `${renderReviewPacket(results)}\n`, "utf8");
  writeFileSync(
    join(BENCHMARK_DIR, "REPORT.md"),
    buildReportMarkdown(results),
    "utf8"
  );

  console.log("[benchmark] complete");
  console.log(JSON.stringify(results.invocationCounts, null, 2));
}

function buildReportMarkdown(results: TrpgBenchmarkResultsFile): string {
  const latencies = results.latenciesMs.filter((value) => value > 0);
  const avg =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : 0;
  const objectiveTotals = {
    inventedEvent: results.fixtures.filter((row) => row.objective.inventedEvent).length,
    wrongLocation: results.fixtures.filter((row) => row.objective.wrongLocation).length,
    rewritesPartyAction: results.fixtures.filter((row) => row.objective.rewritesPartyAction).length,
    deterministicFallback: results.fixtures.filter((row) => row.objective.aiDeterministicFallback)
      .length,
  };
  return [
    "# TRPG Important-Scene Selection Benchmark Report",
    "",
    "Research/benchmark only. GPT/human reviewer scores pending.",
    "",
    "## Reproducibility",
    "",
    `- BASE_MAIN_SHA: \`${results.baseMainSha}\``,
    `- BENCHMARK_HEAD_SHA: \`${results.benchmarkHeadSha}\``,
    `- NODE_VERSION: \`${results.nodeVersion}\``,
    `- PRIMARY_MODEL: \`${results.resolvedPrimaryModel}\``,
    `- FALLBACK_MODEL: \`${results.resolvedFallbackModel ?? "null"}\``,
    `- SCENE_PLAN_MAX_PROVIDER_ATTEMPTS: ${results.scenePlanMaxProviderAttempts}`,
    `- SCENE_PLAN_RETRY_COUNT: ${results.scenePlanRetryCount}`,
    "",
    "## Compatibility",
    "",
    `- EXISTING_CHAT_PLANNER_TRPG_COMPATIBILITY: ${results.compatibility.status}`,
    `- Probe fixtures: ${results.compatibility.probeFixtureIds.join(", ")}`,
    "",
    "## Invocation counts",
    "",
    `- PLAN_CHAT_IMAGE_SCENE_INVOCATIONS: ${results.invocationCounts.planChatImageSceneInvocations}`,
    `- PRIMARY_SUCCESS_COUNT: ${results.invocationCounts.primarySuccessCount}`,
    `- SECONDARY_FALLBACK_SUCCESS_COUNT: ${results.invocationCounts.secondaryFallbackSuccessCount}`,
    `- DETERMINISTIC_FALLBACK_COUNT: ${results.invocationCounts.deterministicFallbackCount}`,
    `- PAID_IMAGE_GENERATION_CALLS: ${results.invocationCounts.paidImageGenerationCalls}`,
    "",
    "## Latency (ms)",
    "",
    `- AVG_AI_LATENCY_MS: ${avg}`,
    `- P50_AI_LATENCY_MS: ${percentile(latencies, 0.5)}`,
    `- P95_AI_LATENCY_MS: ${percentile(latencies, 0.95)}`,
    "",
    "## Objective hard-failure counts",
    "",
    `- inventedEvent: ${objectiveTotals.inventedEvent}`,
    `- wrongLocation: ${objectiveTotals.wrongLocation}`,
    `- rewritesPartyAction: ${objectiveTotals.rewritesPartyAction}`,
    `- deterministicFallback: ${objectiveTotals.deterministicFallback}`,
    "",
    "## GPT/Human scoring rubric (100 points)",
    "",
    "A. MOST IMPORTANT VISUAL BEAT — 35",
    "B. SINGLE-FRAME COHERENCE — 20",
    "C. ACTION / ACTOR FIDELITY — 15",
    "D. CHRONOLOGY / CONSEQUENCE — 10",
    "E. LOCATION / ENVIRONMENT FIDELITY — 10",
    "F. EMOTIONAL / CINEMATIC CLARITY — 10",
    "",
    "## Integration eligibility gates (decide after scoring)",
    "",
    "1. AI wins vs CURRENT_RAW on >= 7/10 fixtures",
    "2. AI wins vs DETERMINISTIC_FIRST on >= 7/10 fixtures",
    "3. AI average score advantage >= +10 over deterministic",
    "4. zero H1–H5 hard fidelity failures",
    "5. deterministic fallback <= 1/10 (>=2/10 = reliability concern)",
    "",
    "## Artifacts",
    "",
    "- fixtures: `fixtures.json`",
    "- raw results: `results.json`",
    "- review packet: `REVIEW_PACKET.md`",
    "",
    "CURSOR_SUBJECTIVE_WINNER: NOT_EVALUATED",
    "GPT_SCORING_STATUS: PENDING",
    "",
  ].join("\n");
}

void main().catch((error) => {
  console.error("[benchmark] failed:", error);
  process.exitCode = 1;
});
