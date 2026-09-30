/**
 * Paid/live experiment phase for candidates that passed deterministic screening
 * but require a real provider model to evaluate. This module is research-only:
 * it mutates only the research ledger passed by the caller.
 */
import { formatBenchmarkMetricsLine } from "@/lib/memory/memory-rp-benchmark";
import type { LiveArmResult, LiveBenchmarkResult } from "../../../scripts/lib/episodicEmbeddingLiveBenchmark";
import { evaluateGates, type LabRunSummary } from "@/lib/memoryResearch/gates";
import {
  buildPersistentGapLivePriority,
  type PersistentGapExperimentRoute,
} from "@/lib/memoryResearch/persistentGapExperimentRouter";
import type { ResearchLedger } from "@/lib/memoryResearch/ledger";
import {
  assertValidTrail,
  cooldownUntilFor,
  decisionState,
  reevaluationConditionFor,
} from "@/lib/memoryResearch/lifecycle";
import {
  findLiveExperimentRecipe,
  liveExperimentRecipeFingerprint,
} from "@/lib/memoryResearch/liveExperimentRecipes";
import type { CandidateDecisionCode, ResearchCandidate } from "@/lib/memoryResearch/types";

export type LiveExperimentRecord = {
  candidateKey: string;
  recipeId: string;
  status: "RAN" | "SKIPPED" | "FAILED";
  decision: CandidateDecisionCode | null;
  reason: string;
  referenceModel: string;
  candidateModel: string;
  actualCostUsd: number;
  priorityGapCaseIds: string[];
};

export type LiveExperimentReport = {
  status: "COMPLETED" | "NOT_RUN";
  startedAt: string;
  finishedAt: string;
  evaluated: number;
  readyForImplementation: number;
  rejected: number;
  watch: number;
  actualCostUsd: number;
  priorityCandidateKeys: string[];
  gapRoutes: PersistentGapExperimentRoute[];
  records: LiveExperimentRecord[];
};

export const LIVE_EXPERIMENT_MAX_CANDIDATES = 2;
export const LIVE_EXPERIMENT_MAX_REPORTED_COST_USD = 0.1;

export type LiveExperimentDeps = {
  now: Date;
  architectureFingerprint: string;
  runBenchmark: (modelIds: readonly string[]) => Promise<LiveBenchmarkResult>;
};

function toLabSummary(arm: LiveArmResult): LabRunSummary {
  return {
    label: `live-${arm.model}`,
    metrics: arm.summary.metrics,
    invariantViolations: arm.invariantViolations,
    evaluatedTurns: arm.summary.evaluatedTurns,
    promptTokensInjected: arm.summary.promptTokensInjected,
    httpCallsObserved: arm.providerCalls,
    embeddingCalls: arm.summary.embeddingCalls,
    wallClockMs: arm.summary.wallClockMs,
    finalHitByCase: arm.summary.finalHitByCase,
  };
}

function perTurn(total: number, turns: number): number {
  return turns > 0 ? total / turns : 0;
}

function updateCandidate(
  candidate: ResearchCandidate,
  input: {
    now: Date;
    architectureFingerprint: string;
    decision: CandidateDecisionCode;
    reason: string;
    recipeId: string;
    recipeVersion: string;
    recipeFingerprint: string;
    reference: LiveArmResult;
    arm: LiveArmResult;
    gateDecision: CandidateDecisionCode;
  }
): ResearchCandidate {
  const state = decisionState(input.decision);
  const trail = ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", state] as const;
  assertValidTrail(trail);
  const referenceCostPer1k =
    input.reference.actualProviderCostUsd == null
      ? null
      : perTurn(input.reference.actualProviderCostUsd, input.reference.summary.evaluatedTurns) * 1000;
  const candidateCostPer1k =
    input.arm.actualProviderCostUsd == null
      ? null
      : perTurn(input.arm.actualProviderCostUsd, input.arm.summary.evaluatedTurns) * 1000;
  const queryP95DeltaMs =
    input.reference.queryRttMs.p95 == null || input.arm.queryRttMs.p95 == null
      ? null
      : input.arm.queryRttMs.p95 - input.reference.queryRttMs.p95;

  return {
    ...candidate,
    state,
    lastDecision: input.decision,
    lastDecisionReason: input.reason,
    priorRejectionReason: state === "REJECTED" ? input.reason : candidate.priorRejectionReason,
    reevaluationCondition: reevaluationConditionFor(input.decision),
    cooldownUntil: cooldownUntilFor(input.decision, input.now),
    evaluations: [
      ...candidate.evaluations,
      {
        cycleKey: `live-${input.now.toISOString().slice(0, 10)}-${input.recipeId}`,
        evaluatedAt: input.now.toISOString(),
        version: candidate.version,
        adapterFingerprint: input.recipeFingerprint,
        architectureFingerprint: input.architectureFingerprint,
        state,
        decision: input.decision,
        reason: input.reason,
        stateTrail: trail,
      },
    ].slice(-20),
    liveExperiment: {
      recipeId: input.recipeId,
      recipeVersion: input.recipeVersion,
      evaluatedAt: input.now.toISOString(),
      referenceModel: input.reference.model,
      candidateModel: input.arm.model,
      gateDecision: input.gateDecision,
      gateReason: input.reason,
      referenceMetrics: formatBenchmarkMetricsLine(input.reference.summary.metrics),
      candidateMetrics: formatBenchmarkMetricsLine(input.arm.summary.metrics),
      candidateCostUsdPer1kTurns: candidateCostPer1k,
      referenceCostUsdPer1kTurns: referenceCostPer1k,
      queryP95DeltaMs,
    },
  };
}

export async function runPendingLiveExperiments(
  ledger: ResearchLedger,
  deps: LiveExperimentDeps
): Promise<{ ledger: ResearchLedger; report: LiveExperimentReport }> {
  const startedAt = deps.now.toISOString();
  const candidates = { ...ledger.candidates };
  const gapPriority = buildPersistentGapLivePriority(ledger);
  const report: LiveExperimentReport = {
    status: "COMPLETED",
    startedAt,
    finishedAt: startedAt,
    evaluated: 0,
    readyForImplementation: 0,
    rejected: 0,
    watch: 0,
    actualCostUsd: 0,
    priorityCandidateKeys: [...gapPriority.priorityCandidateKeys],
    gapRoutes: [...gapPriority.routes],
    records: [],
  };

  const allPending = Object.values(candidates).filter(
    (candidate) => candidate.state === "WATCH" && candidate.lastDecision === "WATCH_LIVE_EXPERIMENT_PENDING"
  );
  const priorityRank = new Map(
    gapPriority.priorityCandidateKeys.map((candidateKey, index) => [candidateKey, index])
  );
  const pending = allPending
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .sort((a, b) => {
      const aPriority = priorityRank.get(a.candidate.candidateKey);
      const bPriority = priorityRank.get(b.candidate.candidateKey);
      if (aPriority != null && bPriority != null) return aPriority - bPriority;
      if (aPriority != null) return -1;
      if (bPriority != null) return 1;
      return a.originalIndex - b.originalIndex;
    })
    .slice(0, LIVE_EXPERIMENT_MAX_CANDIDATES)
    .map(({ candidate }) => candidate);
  if (pending.length === 0) {
    report.status = "NOT_RUN";
    report.finishedAt = new Date().toISOString();
    return { ledger, report };
  }

  const priorityCasesFor = (candidateKey: string): string[] => [
    ...(gapPriority.gapCaseIdsByCandidateKey[candidateKey] ?? []),
  ];

  for (const candidate of pending) {
    const recipe = findLiveExperimentRecipe(candidate.candidateKey);
    if (!recipe) {
      report.watch += 1;
      report.records.push({
        candidateKey: candidate.candidateKey,
        recipeId: "(missing)",
        status: "SKIPPED",
        decision: "WATCH_LIVE_EXPERIMENT_PENDING",
        reason: "live experiment recipe no longer exists",
        referenceModel: "",
        candidateModel: "",
        actualCostUsd: 0,
        priorityGapCaseIds: priorityCasesFor(candidate.candidateKey),
      });
      continue;
    }

    const recipeFingerprint = liveExperimentRecipeFingerprint(recipe)!;
    let live: LiveBenchmarkResult;
    try {
      live = await deps.runBenchmark([recipe.referenceModel.modelId, recipe.candidateModel.modelId]);
    } catch (error) {
      report.watch += 1;
      report.records.push({
        candidateKey: candidate.candidateKey,
        recipeId: recipe.id,
        status: "FAILED",
        decision: "WATCH_BENCHMARK_FAILED",
        reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        referenceModel: recipe.referenceModel.modelId,
        candidateModel: recipe.candidateModel.modelId,
        actualCostUsd: 0,
        priorityGapCaseIds: priorityCasesFor(candidate.candidateKey),
      });
      continue;
    }

    if (live.status === "NOT_RUN") {
      report.status = "NOT_RUN";
      report.watch += 1;
      report.records.push({
        candidateKey: candidate.candidateKey,
        recipeId: recipe.id,
        status: "SKIPPED",
        decision: "WATCH_LIVE_EXPERIMENT_PENDING",
        reason: live.reason,
        referenceModel: recipe.referenceModel.modelId,
        candidateModel: recipe.candidateModel.modelId,
        actualCostUsd: 0,
        priorityGapCaseIds: priorityCasesFor(candidate.candidateKey),
      });
      continue;
    }

    const reference = live.arms.find((arm) => arm.model === recipe.referenceModel.modelId);
    const arm = live.arms.find((candidateArm) => candidateArm.model === recipe.candidateModel.modelId);
    if (!reference || !arm) {
      report.watch += 1;
      report.records.push({
        candidateKey: candidate.candidateKey,
        recipeId: recipe.id,
        status: "FAILED",
        decision: "WATCH_BENCHMARK_FAILED",
        reason: "live benchmark did not return both reference and candidate arms",
        referenceModel: recipe.referenceModel.modelId,
        candidateModel: recipe.candidateModel.modelId,
        actualCostUsd: 0,
        priorityGapCaseIds: priorityCasesFor(candidate.candidateKey),
      });
      continue;
    }

    report.evaluated += 1;
    report.actualCostUsd += (reference.actualProviderCostUsd ?? 0) + (arm.actualProviderCostUsd ?? 0);

    let decision: CandidateDecisionCode;
    let reason: string;
    let gateDecision: CandidateDecisionCode = "WATCH_INSUFFICIENT_EVIDENCE";

    if (reference.failureCount > 0 || arm.failureCount > 0) {
      decision = "WATCH_BENCHMARK_FAILED";
      reason = `live embedding failures reference=${reference.failureCount} candidate=${arm.failureCount}`;
    } else if (
      reference.actualProviderCostUsd == null ||
      arm.actualProviderCostUsd == null ||
      reference.queryRttMs.p95 == null ||
      arm.queryRttMs.p95 == null
    ) {
      decision = "WATCH_INSUFFICIENT_EVIDENCE";
      reason = "live run lacks provider-reported cost or p95 query latency";
    } else {
      const referenceLab = toLabSummary(reference);
      const candidateLab = toLabSummary(arm);
      const costDeltaPer1k = Math.max(
        0,
        perTurn(arm.actualProviderCostUsd, arm.summary.evaluatedTurns) * 1000 -
          perTurn(reference.actualProviderCostUsd, reference.summary.evaluatedTurns) * 1000
      );
      const queryP95Delta = Math.max(0, arm.queryRttMs.p95 - reference.queryRttMs.p95);
      const providerCallsDelta = Math.max(
        0,
        perTurn(arm.providerCalls, arm.summary.evaluatedTurns) -
          perTurn(reference.providerCalls, reference.summary.evaluatedTurns)
      );
      const queryEmbeddingDelta = Math.max(
        0,
        perTurn(arm.summary.embeddingCalls.query, arm.summary.evaluatedTurns) -
          perTurn(reference.summary.embeddingCalls.query, reference.summary.evaluatedTurns)
      );
      const gate = evaluateGates({
        baseline: referenceLab,
        candidate: candidateLab,
        declared: {
          ...recipe.declaredEfficiency,
          providerCallsPerTurn: providerCallsDelta,
          embeddingCallsPerTurn: queryEmbeddingDelta,
          p95LatencyMsPerTurn: queryP95Delta,
          costUsdPer1kTurns: costDeltaPer1k,
        },
        architectureDelta: recipe.architectureDelta,
      });
      gateDecision = gate.decision;
      if (gate.decision === "ACCEPTED_QUALITY_GAIN") {
        decision = "WATCH_IMPLEMENTATION_PR_PENDING";
        reason = `live gate accepted; implementation phase pending: ${gate.reason}`;
      } else {
        decision = gate.decision;
        reason = gate.reason;
      }
    }

    if (gateDecision === "WATCH_INSUFFICIENT_EVIDENCE" && decision !== "WATCH_IMPLEMENTATION_PR_PENDING") {
      gateDecision = decision;
    }
    const updated = updateCandidate(candidate, {
      now: deps.now,
      architectureFingerprint: deps.architectureFingerprint,
      decision,
      reason,
      recipeId: recipe.id,
      recipeVersion: recipe.recipeVersion,
      recipeFingerprint,
      reference,
      arm,
      gateDecision,
    });
    candidates[candidate.candidateKey] = updated;

    if (decision === "WATCH_IMPLEMENTATION_PR_PENDING") report.readyForImplementation += 1;
    else if (decisionState(decision) === "REJECTED") report.rejected += 1;
    else report.watch += 1;

    report.records.push({
      candidateKey: candidate.candidateKey,
      recipeId: recipe.id,
      status: "RAN",
      decision,
      reason,
      referenceModel: reference.model,
      candidateModel: arm.model,
      actualCostUsd: (reference.actualProviderCostUsd ?? 0) + (arm.actualProviderCostUsd ?? 0),
      priorityGapCaseIds: priorityCasesFor(candidate.candidateKey),
    });

    if (report.actualCostUsd >= LIVE_EXPERIMENT_MAX_REPORTED_COST_USD) {
      break;
    }
  }

  report.finishedAt = new Date().toISOString();
  return { ledger: { ...ledger, candidates }, report };
}
