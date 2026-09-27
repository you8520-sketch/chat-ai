import assert from "node:assert/strict";
import { it } from "node:test";
import type { LiveArmResult, LiveBenchmarkResult } from "../../../scripts/lib/episodicEmbeddingLiveBenchmark";
import { runLabArm, runLabBaseline } from "@/lib/memoryResearch/benchmarkLab";
import { narrowSyntheticAdapter, wideSyntheticAdapter } from "@/lib/memoryResearch/labFixtures.test";
import { emptyLedger, type ResearchLedger } from "@/lib/memoryResearch/ledger";
import { liveExperimentRecipeFingerprint, findLiveExperimentRecipe } from "@/lib/memoryResearch/liveExperimentRecipes";
import { runPendingLiveExperiments } from "@/lib/memoryResearch/liveExperimentRunner";
import type { LabRunSummary } from "@/lib/memoryResearch/gates";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

const CANDIDATE_KEY = "github:qwenlm/qwen3-embedding";
const now = new Date("2026-10-01T02:43:00Z");
const recipe = findLiveExperimentRecipe(CANDIDATE_KEY)!;

function pendingLedger(): ResearchLedger {
  const candidate: ResearchCandidate = {
    candidateKey: CANDIDATE_KEY,
    category: "embedding_model",
    sourceKind: "github_repository",
    sourceUrl: "https://github.com/QwenLM/Qwen3-Embedding",
    title: "QwenLM/Qwen3-Embedding",
    version: "v1.0.0",
    discoveredAt: "2026-09-27T00:00:00Z",
    lastSeenAt: "2026-09-27T00:00:00Z",
    summary: "",
    claimedAdvantage: "multilingual embedding quality",
    applicableOwners: ["embedding_index"],
    expectedBenefit: "",
    expectedCost: "",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state: "WATCH",
    lastDecision: "WATCH_LIVE_EXPERIMENT_PENDING",
    lastDecisionReason: "await live benchmark",
    priorRejectionReason: null,
    reevaluationCondition: "monthly live experiment",
    cooldownUntil: null,
    evaluations: [
      {
        cycleKey: "weekly-2026-W39",
        evaluatedAt: "2026-09-27T00:00:00Z",
        version: "v1.0.0",
        adapterFingerprint: liveExperimentRecipeFingerprint(recipe),
        architectureFingerprint: "arch-1",
        state: "WATCH",
        decision: "WATCH_LIVE_EXPERIMENT_PENDING",
        reason: "await live benchmark",
        stateTrail: ["RESEARCHED", "SCREENED", "WATCH"],
      },
    ],
    draftPrUrl: null,
  };
  const ledger = emptyLedger();
  ledger.candidates[CANDIDATE_KEY] = candidate;
  return ledger;
}

function arm(model: string, summary: LabRunSummary, cost = 0.0001): LiveArmResult {
  return {
    arm: model.includes("qwen") ? "B" : "A",
    model,
    dimensions: model.includes("qwen") ? 4096 : 1024,
    queryRttMs: { p50: 50, p95: 80, max: 90, count: Math.max(1, summary.embeddingCalls.query) },
    batchRttMs: { p50: 60, p95: 90, max: 100, count: Math.max(1, summary.embeddingCalls.index) },
    candidateRecall: summary.metrics.candidateRecallAtK.value,
    finalRecall: summary.metrics.finalRecallAt8.value,
    falseInjectionRate: summary.metrics.falseInjectionRate.value,
    staleStateRate: summary.metrics.staleStateRecallRate.value,
    knownGap: { candidateHit: false, finalHit: false },
    knownGapSemantic: null,
    milestoneRetention: "1/1",
    milestoneCaseSemantic: { admitted: 0, novel: 0, overlap: 0, added: 0 },
    providerCalls: summary.embeddingCalls.query + summary.embeddingCalls.index,
    inputTokens: 100,
    actualProviderCostUsd: cost,
    failureCount: 0,
    failureSamples: [],
    invariantViolations: [...summary.invariantViolations],
    summary: {
      metrics: summary.metrics,
      evaluatedTurns: summary.evaluatedTurns,
      promptTokensInjected: summary.promptTokensInjected,
      finalHitByCase: { ...summary.finalHitByCase },
      wallClockMs: summary.wallClockMs,
      embeddingCalls: { ...summary.embeddingCalls },
    },
  };
}

async function resultFor(kind: "wide" | "narrow"): Promise<LiveBenchmarkResult> {
  const baselineRun = await runLabBaseline();
  assert.equal(baselineRun.status, "RAN");
  if (baselineRun.status !== "RAN") throw new Error("baseline failed");
  const adapter = kind === "wide" ? wideSyntheticAdapter(CANDIDATE_KEY) : narrowSyntheticAdapter(CANDIDATE_KEY);
  const candidateRun = await runLabArm({ ...adapter.buildMode(), strict: false });
  assert.equal(candidateRun.status, "RAN");
  if (candidateRun.status !== "RAN") throw new Error("candidate failed");
  const reference = arm(recipe.referenceModel.modelId, baselineRun.summary);
  const candidate = arm(recipe.candidateModel.modelId, candidateRun.summary);
  return {
    status: "RAN",
    baseline: {
      candidateRecall: baselineRun.summary.metrics.candidateRecallAtK.value,
      finalRecall: baselineRun.summary.metrics.finalRecallAt8.value,
    },
    baselineSummary: {
      metrics: baselineRun.summary.metrics,
      evaluatedTurns: baselineRun.summary.evaluatedTurns,
      promptTokensInjected: baselineRun.summary.promptTokensInjected,
      finalHitByCase: { ...baselineRun.summary.finalHitByCase },
      wallClockMs: baselineRun.summary.wallClockMs,
      embeddingCalls: { ...baselineRun.summary.embeddingCalls },
    },
    arms: [reference, candidate],
  };
}

it("accepted live evidence is held at WATCH_IMPLEMENTATION_PR_PENDING, not activated", async () => {
  const live = await resultFor("wide");
  const out = await runPendingLiveExperiments(pendingLedger(), {
    now,
    architectureFingerprint: "arch-1",
    runBenchmark: async () => live,
  });
  const candidate = out.ledger.candidates[CANDIDATE_KEY]!;
  assert.equal(candidate.state, "WATCH");
  assert.equal(candidate.lastDecision, "WATCH_IMPLEMENTATION_PR_PENDING");
  assert.equal(out.report.readyForImplementation, 1);
  assert.equal(candidate.liveExperiment?.referenceModel, recipe.referenceModel.modelId);
  assert.equal(candidate.liveExperiment?.candidateModel, recipe.candidateModel.modelId);
});

it("a live regression is rejected and never becomes implementation-pending", async () => {
  const live = await resultFor("narrow");
  const out = await runPendingLiveExperiments(pendingLedger(), {
    now,
    architectureFingerprint: "arch-1",
    runBenchmark: async () => live,
  });
  const candidate = out.ledger.candidates[CANDIDATE_KEY]!;
  assert.equal(candidate.state, "REJECTED");
  assert.notEqual(candidate.lastDecision, "WATCH_IMPLEMENTATION_PR_PENDING");
  assert.equal(out.report.readyForImplementation, 0);
  assert.equal(out.report.rejected, 1);
});

it("missing benchmark opt-in leaves the candidate pending without mutating evidence", async () => {
  const before = pendingLedger();
  const out = await runPendingLiveExperiments(before, {
    now,
    architectureFingerprint: "arch-1",
    runBenchmark: async () => ({ status: "NOT_RUN", reason: "benchmark secret absent", providerCalls: 0 }),
  });
  assert.equal(out.report.status, "NOT_RUN");
  assert.equal(out.ledger.candidates[CANDIDATE_KEY]!.lastDecision, "WATCH_LIVE_EXPERIMENT_PENDING");
  assert.equal(out.ledger.candidates[CANDIDATE_KEY]!.liveExperiment, undefined);
});
