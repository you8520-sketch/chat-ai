/**
 * One research cycle: DISCOVER → SCREEN → EXPERIMENT → BENCHMARK →
 * ACCEPT/REJECT → Draft PR packet. Pure orchestration over injected sources,
 * adapters and lab runner; returns the next ledger + an observability report.
 * It never writes to production memory owners, the production DB, or prompts.
 */
import { runLabArm, type LabArmResult } from "@/lib/memoryResearch/benchmarkLab";
import { adapterFingerprint, findAdapter, type ExperimentAdapter } from "@/lib/memoryResearch/experiments";
import { findLiveExperimentRecipe, liveExperimentRecipeFingerprint, type LiveExperimentRecipe } from "@/lib/memoryResearch/liveExperimentRecipes";
import { evaluateGates, type GateResult, type LabRunSummary } from "@/lib/memoryResearch/gates";
import type { ResearchLedger } from "@/lib/memoryResearch/ledger";
import {
  assertValidTrail,
  cooldownUntilFor,
  decideReevaluation,
  decisionState,
  reevaluationConditionFor,
  type ReevaluationTrigger,
  type SkipReason,
} from "@/lib/memoryResearch/lifecycle";
import { buildDraftPrPacket, type DraftPrPacket } from "@/lib/memoryResearch/prPacket";
import { screenCandidate } from "@/lib/memoryResearch/screening";
import type { SourceAdapter, SourceContext } from "@/lib/memoryResearch/sources";
import type {
  CandidateDecisionCode,
  CandidateLifecycleState,
  ResearchCandidate,
  ResearchObservation,
} from "@/lib/memoryResearch/types";
import { BASELINE_MODE, type BenchmarkMode } from "@/lib/memory/memory-rp-benchmark-suite";

export type CycleMode = "weekly" | "monthly_deep";

/** Paid provider calls the cycle may make. Research + deterministic lab = 0 by construction. */
export const PAID_PROVIDER_CALL_BUDGET = 0;
export const DEFAULT_HTTP_BUDGET = 40;

export function cycleKeyFor(mode: CycleMode, now: Date): string {
  if (mode === "monthly_deep") {
    return `monthly-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type CycleDecisionRecord = {
  candidateKey: string;
  version: string | null;
  trigger: ReevaluationTrigger;
  trail: CandidateLifecycleState[];
  decision: CandidateDecisionCode;
  reason: string;
};

export type CycleBenchmarkRecord = {
  candidateKey: string;
  arm: LabArmResult["status"];
  gate: GateResult | null;
  error: string | null;
};

export type CycleReport = {
  cycleKey: string;
  mode: CycleMode;
  status: "COMPLETED" | "SKIPPED_ALREADY_RAN";
  startedAt: string;
  finishedAt: string;
  mainSha: string;
  architectureFingerprint: string;
  sources: Array<{ sourceId: string; observations: number; errors: string[]; failed: boolean }>;
  counts: {
    sourcesChecked: number;
    sourcesFailed: number;
    observations: number;
    newCandidates: number;
    skippedDuplicates: number;
    evaluated: number;
    watch: number;
    reject: number;
    benchmarked: number;
    accept: number;
    draftPrPackets: number;
  };
  skipped: Array<{ candidateKey: string; reason: SkipReason | "duplicate_in_cycle" }>;
  decisions: CycleDecisionRecord[];
  baseline: { status: LabArmResult["status"]; metricsLine: string | null; error: string | null };
  benchmarks: CycleBenchmarkRecord[];
  providerCalls: { paidProviderCalls: number; paidProviderCallBudget: number; httpCalls: number; httpBudget: number };
  estimatedCostUsd: number;
  draftPrPackets: DraftPrPacket[];
  /** Registered adapters whose candidate is REJECTED — delete from the lab. */
  cleanupCandidates: string[];
  productionTouched: false;
};

export type CycleDeps = {
  mode: CycleMode;
  now: Date;
  mainSha: string;
  architectureFingerprint: string;
  sources: readonly SourceAdapter[];
  sourceContext: SourceContext;
  adapters: readonly ExperimentAdapter[];
  runArm?: (mode: BenchmarkMode) => Promise<LabArmResult>;
  force?: boolean;
  formatMetricsLine?: (summary: LabRunSummary) => string;
};

type Evaluated = {
  decision: CandidateDecisionCode;
  reason: string;
  trail: CandidateLifecycleState[];
  applicableOwners: ResearchCandidate["applicableOwners"];
  benchmark: { gate: GateResult; experiment: LabRunSummary } | null;
};

export async function runResearchCycle(
  ledger: ResearchLedger,
  deps: CycleDeps
): Promise<{ ledger: ResearchLedger; report: CycleReport }> {
  const startedAt = deps.now.toISOString();
  const cycleKey = cycleKeyFor(deps.mode, deps.now);
  const runArm = deps.runArm ?? runLabArm;
  const report: CycleReport = {
    cycleKey,
    mode: deps.mode,
    status: "COMPLETED",
    startedAt,
    finishedAt: startedAt,
    mainSha: deps.mainSha,
    architectureFingerprint: deps.architectureFingerprint,
    sources: [],
    counts: {
      sourcesChecked: 0,
      sourcesFailed: 0,
      observations: 0,
      newCandidates: 0,
      skippedDuplicates: 0,
      evaluated: 0,
      watch: 0,
      reject: 0,
      benchmarked: 0,
      accept: 0,
      draftPrPackets: 0,
    },
    skipped: [],
    decisions: [],
    baseline: { status: "FAILED", metricsLine: null, error: "not run" },
    benchmarks: [],
    providerCalls: {
      paidProviderCalls: 0,
      paidProviderCallBudget: PAID_PROVIDER_CALL_BUDGET,
      httpCalls: 0,
      httpBudget: deps.sourceContext.budget.limit,
    },
    estimatedCostUsd: 0,
    draftPrPackets: [],
    cleanupCandidates: [],
    productionTouched: false,
  };

  if (!deps.force && ledger.cycles.some((c) => c.cycleKey === cycleKey)) {
    report.status = "SKIPPED_ALREADY_RAN";
    return { ledger, report };
  }

  // DISCOVER — every source isolated; a failing source never aborts the cycle.
  const observations: ResearchObservation[] = [];
  for (const source of deps.sources) {
    report.counts.sourcesChecked += 1;
    try {
      const collected = await source.collect(deps.sourceContext);
      const failed = collected.observations.length === 0 && collected.errors.length > 0;
      if (failed) report.counts.sourcesFailed += 1;
      report.sources.push({ sourceId: source.id, observations: collected.observations.length, errors: collected.errors, failed });
      observations.push(...collected.observations);
    } catch (error) {
      report.counts.sourcesFailed += 1;
      report.sources.push({
        sourceId: source.id,
        observations: 0,
        errors: [error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)],
        failed: true,
      });
    }
  }
  report.providerCalls.httpCalls = deps.sourceContext.budget.used;
  report.counts.observations = observations.length;

  // Baseline once per cycle: health snapshot + A/B reference.
  const baselineArm = await runArm(BASELINE_MODE);
  let baseline: LabRunSummary | null = null;
  if (baselineArm.status === "RAN") {
    baseline = baselineArm.summary;
    report.baseline = {
      status: "RAN",
      metricsLine: deps.formatMetricsLine ? deps.formatMetricsLine(baseline) : null,
      error: null,
    };
  } else {
    report.baseline = { status: "FAILED", metricsLine: null, error: baselineArm.error };
  }

  const candidates = { ...ledger.candidates };
  const seenThisCycle = new Set<string>();
  const nowIso = deps.now.toISOString();

  for (const obs of observations) {
    if (seenThisCycle.has(obs.candidateKey)) {
      report.counts.skippedDuplicates += 1;
      report.skipped.push({ candidateKey: obs.candidateKey, reason: "duplicate_in_cycle" });
      continue;
    }
    seenThisCycle.add(obs.candidateKey);
    const existing = candidates[obs.candidateKey];
    const adapter = findAdapter(deps.adapters, obs.candidateKey);
    const liveRecipe = findLiveExperimentRecipe(obs.candidateKey);
    const fingerprint = adapterFingerprint(adapter) ?? liveExperimentRecipeFingerprint(liveRecipe);
    const re = decideReevaluation(existing, obs, {
      now: deps.now,
      adapterFingerprint: fingerprint,
      architectureFingerprint: deps.architectureFingerprint,
      deepReview: deps.mode === "monthly_deep",
    });

    if (!re.evaluate) {
      report.counts.skippedDuplicates += 1;
      report.skipped.push({ candidateKey: obs.candidateKey, reason: re.skip });
      if (existing) candidates[obs.candidateKey] = { ...existing, lastSeenAt: nowIso };
      continue;
    }
    if (!existing) report.counts.newCandidates += 1;
    report.counts.evaluated += 1;

    const evaluated = await evaluateObservation(obs, adapter, liveRecipe, baseline, report, deps.now, runArm);
    assertValidTrail(evaluated.trail);
    const state = decisionState(evaluated.decision);
    const decisionRecord: CycleDecisionRecord = {
      candidateKey: obs.candidateKey,
      version: obs.version,
      trigger: re.trigger,
      trail: evaluated.trail,
      decision: evaluated.decision,
      reason: evaluated.reason,
    };
    report.decisions.push(decisionRecord);
    if (state === "WATCH") report.counts.watch += 1;
    if (state === "REJECTED") report.counts.reject += 1;
    if (state === "ACCEPTED") report.counts.accept += 1;

    const next: ResearchCandidate = {
      candidateKey: obs.candidateKey,
      category: obs.category,
      sourceKind: obs.sourceKind,
      sourceUrl: obs.sourceUrl,
      title: obs.title,
      version: obs.version ?? existing?.version ?? null,
      discoveredAt: existing?.discoveredAt ?? nowIso,
      lastSeenAt: nowIso,
      summary: obs.summary,
      claimedAdvantage: obs.claimedAdvantage,
      applicableOwners: evaluated.applicableOwners,
      expectedBenefit: obs.claimedAdvantage || "(unstated)",
      expectedCost: adapter
        ? `declared: ${JSON.stringify(adapter.declaredEfficiency)}`
        : `infra: ${obs.infraRequirements.join(", ")}`,
      infraRequirements: obs.infraRequirements,
      privacyImplications: obs.privacyImplications,
      migrationRequirement: obs.migrationRequirement,
      state,
      lastDecision: evaluated.decision,
      lastDecisionReason: evaluated.reason,
      priorRejectionReason: state === "REJECTED" ? evaluated.reason : existing?.priorRejectionReason ?? null,
      reevaluationCondition: reevaluationConditionFor(evaluated.decision),
      cooldownUntil: cooldownUntilFor(evaluated.decision, deps.now),
      evaluations: [
        ...(existing?.evaluations ?? []),
        {
          cycleKey,
          evaluatedAt: nowIso,
          version: obs.version,
          adapterFingerprint: fingerprint,
          architectureFingerprint: deps.architectureFingerprint,
          state,
          decision: evaluated.decision,
          reason: evaluated.reason,
          stateTrail: evaluated.trail,
        },
      ].slice(-20),
      draftPrUrl: state === "ACCEPTED" ? null : existing?.draftPrUrl ?? null,
    };
    candidates[obs.candidateKey] = next;

    if (state === "ACCEPTED" && adapter && baseline && evaluated.benchmark) {
      report.draftPrPackets.push(
        buildDraftPrPacket({
          candidate: next,
          adapter,
          gate: evaluated.benchmark.gate,
          baseline,
          experiment: evaluated.benchmark.experiment,
          cycleKey,
          mainSha: deps.mainSha,
        })
      );
    }
  }

  report.counts.draftPrPackets = report.draftPrPackets.length;
  report.cleanupCandidates = deps.adapters
    .filter((a) => candidates[a.candidateKey]?.state === "REJECTED")
    .map((a) => `${a.candidateKey}@${a.adapterVersion}`)
    .sort();
  report.finishedAt = new Date().toISOString();

  const nextLedger: ResearchLedger = {
    ...ledger,
    candidates,
    cycles: [
      ...ledger.cycles,
      {
        cycleKey,
        mode: deps.mode,
        finishedAt: report.finishedAt,
        mainSha: deps.mainSha,
        counts: { ...report.counts, paidProviderCalls: 0, httpCalls: report.providerCalls.httpCalls },
      },
    ],
  };
  return { ledger: nextLedger, report };
}

async function evaluateObservation(
  obs: ResearchObservation,
  adapter: ExperimentAdapter | undefined,
  liveRecipe: LiveExperimentRecipe | undefined,
  baseline: LabRunSummary | null,
  report: CycleReport,
  now: Date,
  runArm: (mode: BenchmarkMode) => Promise<LabArmResult>
): Promise<Evaluated> {
  const screening = screenCandidate(obs, adapter, now, liveRecipe);
  if (screening.outcome === "STOP") {
    return {
      decision: screening.decision,
      reason: screening.reason,
      trail: ["RESEARCHED", "SCREENED", decisionState(screening.decision)],
      applicableOwners: screening.applicableOwners,
      benchmark: null,
    };
  }
  const trail: CandidateLifecycleState[] = ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE"];
  if (!baseline) {
    report.benchmarks.push({ candidateKey: obs.candidateKey, arm: "FAILED", gate: null, error: `baseline unhealthy: ${report.baseline.error}` });
    return {
      decision: "WATCH_BENCHMARK_FAILED",
      reason: `baseline benchmark failed on main (${report.baseline.error}); candidate not evaluated`,
      trail: [...trail, "WATCH"],
      applicableOwners: screening.applicableOwners,
      benchmark: null,
    };
  }
  let arm: LabArmResult;
  try {
    const built = adapter!.buildMode();
    arm = await runArm({ ...built, label: `lab-${obs.candidateKey}@${adapter!.adapterVersion}`, strict: false, expectKnownGapHit: undefined });
  } catch (error) {
    arm = { status: "FAILED", label: obs.candidateKey, error: error instanceof Error ? error.message : String(error), httpCallsAttempted: 0 };
  }
  if (arm.status === "FAILED") {
    report.benchmarks.push({ candidateKey: obs.candidateKey, arm: "FAILED", gate: null, error: arm.error });
    return {
      decision: "WATCH_BENCHMARK_FAILED",
      reason: `candidate arm failed: ${arm.error}`,
      trail: [...trail, "WATCH"],
      applicableOwners: screening.applicableOwners,
      benchmark: null,
    };
  }
  report.counts.benchmarked += 1;
  const gate = evaluateGates({
    baseline,
    candidate: arm.summary,
    declared: adapter!.declaredEfficiency,
    architectureDelta: adapter!.architectureDelta,
  });
  report.benchmarks.push({ candidateKey: obs.candidateKey, arm: "RAN", gate, error: null });
  return {
    decision: gate.decision,
    reason: gate.reason,
    trail: [...trail, "BENCHMARKED", decisionState(gate.decision)],
    applicableOwners: screening.applicableOwners,
    benchmark: { gate, experiment: arm.summary },
  };
}
