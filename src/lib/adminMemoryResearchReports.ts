import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  type GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";
import { githubReportGetContent } from "@/lib/githubReportClient";

export const MEMORY_RESEARCH_LEDGER_BRANCH = "memory-research-ledger";
export const MEMORY_RESEARCH_WORKFLOW_PATH =
  ".github/workflows/memory-research-cycle.yml";

export const MEMORY_RESEARCH_STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;
export const MEMORY_RESEARCH_PERSISTENCE_LAG_TOLERANCE_MS =
  30 * 60 * 1000;

export type MemoryResearchAdminCounts = {
  sourcesChecked: number;
  sourcesFailed: number;
  observations: number;
  newCandidates: number;
  evaluated: number;
  watch: number;
  reject: number;
  benchmarked: number;
  accept: number;
  draftPrPackets: number;
};

export type MemoryResearchAdminReadinessCounts = {
  readyDeterministic: number;
  readyDurableLedger: number;
  readyMutationLifecycle: number;
  mixedOwner: number;
  harnessExtensionRequired: number;
  noPortRequired: number;
};

export type MemoryResearchAdminPromptPackingModel = {
  modelId: string;
  baselineInputTokens: number;
  n15InputTokens: number;
  n15DeltaInputTokens: number;
  n15MediumTokens: number;
  safeForPolicyConsideration: boolean;
};

export type MemoryResearchAdminPromptPacking = {
  status: "PASS" | "FAIL";
  generatedAt: string;
  currentTurnFixture: number;
  policyId: string;
  rawRecentExchanges: number;
  rollingSummaryInterval: number;
  mediumTermBlockCount: number;
  invariantPasses: number;
  invariantTotal: number;
  failedInvariants: string[];
  models: MemoryResearchAdminPromptPackingModel[];
};

export type MemoryResearchAdminPromptPackingTrendModel = {
  modelId: string;
  n15DeltaInputTokensDelta: number;
  mediumTokensDelta: number;
  verdict: string;
};

export type MemoryResearchAdminPromptPackingTrend = {
  status: string;
  previousCycleKey: string | null;
  comparable: boolean;
  modelSetChanged: boolean;
  addedModels: string[];
  removedModels: string[];
  modelDeltas: MemoryResearchAdminPromptPackingTrendModel[];
  note: string;
};

export type MemoryResearchAdminDecision = {
  candidateKey: string;
  decision: string;
  reason: string;
};

export type MemoryResearchAdminEffectiveness = {
  totalCandidates: number;
  watch: number;
  rejected: number;
  accepted: number;
  acceptedDraftPrs: number;
  implementationPrs: number;
  liveEvaluated: number;
  dueForReevaluation: number;
  repeatedWatch: number;
  watchBottlenecks: Array<{
    decision: string;
    candidates: number;
    examples: string[];
  }>;
  bySourceKind: Array<{
    sourceKind: string;
    candidates: number;
    watch: number;
    rejected: number;
    accepted: number;
    acceptedDraftPrs: number;
    implementationPrs: number;
    liveEvaluated: number;
  }>;
};

export type MemoryResearchAdminInsight = {
  kind:
    | "COMPANION"
    | "BENCHMARK"
    | "CASE_PORT"
    | "HARNESS"
    | "LOCAL_GOLD"
    | "PERSISTENT_GAP";
  key: string;
  status: string;
  summary: string;
  nextAction: string;
};

export type MemoryResearchAdminPipelineItem = {
  candidateKey: string;
  state: string;
  lastDecision: string;
  draftPrUrl: string | null;
  implementationPrUrl: string | null;
  liveEvaluatedAt: string | null;
  liveCandidateModel: string | null;
  liveGateDecision: string | null;
  liveCostUsdPer1kTurns: number | null;
};

export type MemoryResearchAdminPipeline = {
  pendingLiveExperiments: number;
  recordedLiveExperiments: number;
  pendingImplementationPrs: number;
  implementationPrs: number;
  acceptedDraftPrs: number;
  items: MemoryResearchAdminPipelineItem[];
};

export type MemoryResearchAdminRun = {
  cycleKey: string;
  mode: string;
  status: string;
  finishedAt: string;
  mainSha: string;
  counts: MemoryResearchAdminCounts;
  paidProviderCalls: number;
  httpCalls: number;
  httpBudget: number;
  estimatedCostUsd: number;
  productionTouched: boolean;
  baselinePromotionGateStatus: string | null;
  baselinePromotionBlocked: boolean | null;
  companionExperimentProposals: number;
  benchmarkAdoptionProposals: number;
  benchmarkCasePortPlans: number;
  benchmarkHarnessFeasibility: number;
  localGoldAuthoringPackets: number;
  persistentMemoryGaps: number;
  persistentMemoryGapStatus: string | null;
  promptPackingAudit: MemoryResearchAdminPromptPacking | null;
  promptPackingTrend: MemoryResearchAdminPromptPackingTrend | null;
  readiness: MemoryResearchAdminReadinessCounts;
  insights: MemoryResearchAdminInsight[];
  effectiveness: MemoryResearchAdminEffectiveness | null;
  decisions: MemoryResearchAdminDecision[];
};

export type MemoryResearchFreshnessStatus =
  | "FRESH"
  | "STALE_CYCLE"
  | "PERSISTENCE_LAG"
  | "UNKNOWN";

export type MemoryResearchAdminProjection = {
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  run: MemoryResearchAdminRun | null;
  githubRunUrl: string | null;
  persistedReportUrl: string | null;
  freshnessStatus: MemoryResearchFreshnessStatus;
  freshnessReason: string | null;
  pipeline: MemoryResearchAdminPipeline;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown): string[] {
  return asArray(value).map(asString).filter(Boolean);
}

function projectPromptPackingAudit(
  value: unknown
): MemoryResearchAdminPromptPacking | null {
  const audit = asRecord(value);
  if (!audit) return null;
  const architecture = asRecord(audit.architecture);
  const invariants = asArray(audit.invariants)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null);
  const models = asArray(audit.models)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({
      modelId: asString(row.modelId),
      baselineInputTokens: asNumber(row.baselineInputTokens),
      n15InputTokens: asNumber(row.n15InputTokens),
      n15DeltaInputTokens: asNumber(row.n15DeltaInputTokens),
      n15MediumTokens: asNumber(row.n15MediumTokens),
      safeForPolicyConsideration: row.n15SafeForPolicyConsideration === true,
    }))
    .filter((row) => row.modelId);

  const generatedAt = asString(audit.generatedAt);
  const policyId = architecture ? asString(architecture.policyId) : "";
  const failedInvariants = invariants
    .filter((row) => row.ok !== true)
    .map((row) => asString(row.id))
    .filter(Boolean);
  const structurallyValid =
    Boolean(generatedAt) &&
    Boolean(policyId) &&
    invariants.length > 0 &&
    models.length > 0;
  if (!structurallyValid) {
    failedInvariants.unshift("MALFORMED_PROMPT_PACKING_AUDIT");
  }

  return {
    status: failedInvariants.length === 0 ? "PASS" : "FAIL",
    generatedAt,
    currentTurnFixture: asNumber(audit.currentTurnFixture),
    policyId,
    rawRecentExchanges: architecture
      ? asNumber(architecture.rawRecentExchanges)
      : 0,
    rollingSummaryInterval: architecture
      ? asNumber(architecture.rollingSummaryInterval)
      : 0,
    mediumTermBlockCount: architecture
      ? asNumber(architecture.mediumTermBlockCount)
      : 0,
    invariantPasses: invariants.filter((row) => row.ok === true).length,
    invariantTotal: invariants.length,
    failedInvariants,
    models,
  };
}

function projectPromptPackingTrend(
  value: unknown
): MemoryResearchAdminPromptPackingTrend | null {
  const trend = asRecord(value);
  if (!trend) return null;
  const status = asString(trend.status);
  if (!status) return null;
  return {
    status,
    previousCycleKey: asString(trend.previousCycleKey) || null,
    comparable: trend.comparable === true,
    modelSetChanged: trend.modelSetChanged === true,
    addedModels: stringList(trend.addedModels),
    removedModels: stringList(trend.removedModels),
    modelDeltas: asArray(trend.modelDeltas)
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => ({
        modelId: asString(row.modelId),
        n15DeltaInputTokensDelta: asNumber(row.n15DeltaInputTokensDelta),
        mediumTokensDelta: asNumber(row.mediumTokensDelta),
        verdict: asString(row.verdict),
      }))
      .filter((row) => row.modelId),
    note: asString(trend.note),
  };
}

function projectMemoryResearchInsights(
  cycle: Record<string, unknown>
): MemoryResearchAdminInsight[] {
  const insights: MemoryResearchAdminInsight[] = [];

  for (const raw of asArray(cycle.companionExperimentProposals)) {
    const row = asRecord(raw);
    if (!row) continue;
    const key = asString(row.candidateKey);
    const technique = asString(row.technique);
    const status = asString(row.classification);
    if (!key || !status) continue;
    const owners = stringList(row.targetOwners);
    insights.push({
      kind: "COMPANION",
      key: technique ? `${key} · ${technique}` : key,
      status,
      summary:
        asString(row.localCoverage) ||
        (owners.length ? `owners: ${owners.join(", ")}` : ""),
      nextAction: asString(row.nextAction),
    });
  }

  for (const raw of asArray(cycle.benchmarkAdoptionProposals)) {
    const row = asRecord(raw);
    if (!row) continue;
    const key = asString(row.candidateKey);
    const ability = asString(row.ability);
    const status = asString(row.status);
    if (!key || !status) continue;
    insights.push({
      kind: "BENCHMARK",
      key: ability ? `${key} · ${ability}` : key,
      status,
      summary: asString(row.gap) || asString(row.coverage),
      nextAction: asString(row.nextAction),
    });
  }

  for (const raw of asArray(cycle.benchmarkCasePortPlans)) {
    const row = asRecord(raw);
    if (!row) continue;
    const key = asString(row.planKey) || asString(row.candidateKey);
    const status = asString(row.readiness);
    if (!key || !status) continue;
    const cases = stringList(row.proposedCaseIds);
    insights.push({
      kind: "CASE_PORT",
      key,
      status,
      summary:
        [asString(row.canonicalOwner), cases.length ? `cases: ${cases.join(", ")}` : ""]
          .filter(Boolean)
          .join(" · "),
      nextAction: asString(row.rationale),
    });
  }

  for (const raw of asArray(cycle.benchmarkHarnessFeasibility)) {
    const row = asRecord(raw);
    if (!row) continue;
    const key = asString(row.planKey) || asString(row.candidateKey);
    const status = asString(row.status);
    if (!key || !status) continue;
    insights.push({
      kind: "HARNESS",
      key,
      status,
      summary: asString(row.blocker),
      nextAction: asString(row.safeNextAction),
    });
  }

  for (const raw of asArray(cycle.localGoldAuthoringPackets)) {
    const row = asRecord(raw);
    if (!row) continue;
    const key = asString(row.packetKey) || asString(row.planKey);
    const status = asString(row.status);
    if (!key || !status) continue;
    const cases = stringList(row.proposedCaseIds);
    insights.push({
      kind: "LOCAL_GOLD",
      key,
      status,
      summary: cases.length ? `cases: ${cases.join(", ")}` : asString(row.targetHarness),
      nextAction: asString(row.nextAction),
    });
  }

  const persistent = asRecord(cycle.persistentMemoryGaps);
  for (const raw of asArray(persistent?.persistentGaps)) {
    const row = asRecord(raw);
    if (!row) continue;
    const caseId = asString(row.caseId);
    if (!caseId) continue;
    const failures = asNumber(row.consecutiveComparableFailures);
    const owners = stringList(row.ownerHints);
    insights.push({
      kind: "PERSISTENT_GAP",
      key: caseId,
      status: failures ? `${failures} consecutive failures` : "PERSISTENT_GAP",
      summary: owners.length ? `owners: ${owners.join(", ")}` : "",
      nextAction: asString(row.nextAction),
    });
  }

  return insights;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

const EMPTY_PIPELINE: MemoryResearchAdminPipeline = {
  pendingLiveExperiments: 0,
  recordedLiveExperiments: 0,
  pendingImplementationPrs: 0,
  implementationPrs: 0,
  acceptedDraftPrs: 0,
  items: [],
};

export function projectMemoryResearchAdminPipeline(
  rawLedger: string | null
): MemoryResearchAdminPipeline {
  const ledger = parseJsonRecord(rawLedger);
  const candidates = ledger ? asRecord(ledger.candidates) : null;
  if (!candidates) return EMPTY_PIPELINE;

  const items: MemoryResearchAdminPipelineItem[] = [];
  let pendingLiveExperiments = 0;
  let recordedLiveExperiments = 0;
  let pendingImplementationPrs = 0;
  let implementationPrs = 0;
  let acceptedDraftPrs = 0;

  for (const [candidateKey, rawCandidate] of Object.entries(candidates)) {
    const candidate = asRecord(rawCandidate);
    if (!candidate) continue;
    const lastDecision = asString(candidate.lastDecision);
    const draftPrUrl = asString(candidate.draftPrUrl) || null;
    const implementationPrUrl = asString(candidate.implementationPrUrl) || null;
    const live = asRecord(candidate.liveExperiment);

    if (lastDecision === "WATCH_LIVE_EXPERIMENT_PENDING" && !live) {
      pendingLiveExperiments += 1;
    }
    if (
      lastDecision === "WATCH_IMPLEMENTATION_PR_PENDING" &&
      !implementationPrUrl
    ) {
      pendingImplementationPrs += 1;
    }
    if (live) recordedLiveExperiments += 1;
    if (implementationPrUrl) implementationPrs += 1;
    if (draftPrUrl) acceptedDraftPrs += 1;

    if (
      lastDecision === "WATCH_LIVE_EXPERIMENT_PENDING" ||
      lastDecision === "WATCH_IMPLEMENTATION_PR_PENDING" ||
      live ||
      implementationPrUrl ||
      draftPrUrl
    ) {
      const cost = live ? live.candidateCostUsdPer1kTurns : null;
      items.push({
        candidateKey: asString(candidate.candidateKey) || candidateKey,
        state: asString(candidate.state),
        lastDecision,
        draftPrUrl,
        implementationPrUrl,
        liveEvaluatedAt: live ? asString(live.evaluatedAt) || null : null,
        liveCandidateModel: live ? asString(live.candidateModel) || null : null,
        liveGateDecision: live ? asString(live.gateDecision) || null : null,
        liveCostUsdPer1kTurns:
          typeof cost === "number" && Number.isFinite(cost) ? cost : null,
      });
    }
  }

  items.sort((a, b) =>
    (b.liveEvaluatedAt ?? "").localeCompare(a.liveEvaluatedAt ?? "") ||
    a.candidateKey.localeCompare(b.candidateKey)
  );

  return {
    pendingLiveExperiments,
    recordedLiveExperiments,
    pendingImplementationPrs,
    implementationPrs,
    acceptedDraftPrs,
    items: items.slice(0, 10),
  };
}

function latestCycleKeyFromLedger(raw: string | null): string | null {
  const ledger = parseJsonRecord(raw);
  if (!ledger) return null;
  const cycles = asArray(ledger.cycles)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .filter((row) => asString(row.cycleKey));
  if (cycles.length === 0) return null;
  cycles.sort((a, b) =>
    asString(b.finishedAt).localeCompare(asString(a.finishedAt))
  );
  return asString(cycles[0]?.cycleKey) || null;
}

function projectMemoryResearchEffectiveness(
  raw: unknown
): MemoryResearchAdminEffectiveness | null {
  const audit = asRecord(raw);
  if (!audit) return null;

  const watchBottlenecks = asArray(audit.watchBottlenecks)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({
      decision: asString(row.decision),
      candidates: asNumber(row.candidates),
      examples: stringList(row.exampleCandidateKeys),
    }))
    .filter((row) => row.decision);

  const bySourceKind = asArray(audit.bySourceKind)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({
      sourceKind: asString(row.sourceKind),
      candidates: asNumber(row.candidates),
      watch: asNumber(row.watch),
      rejected: asNumber(row.rejected),
      accepted: asNumber(row.accepted),
      acceptedDraftPrs: asNumber(row.acceptedDraftPrs),
      implementationPrs: asNumber(row.implementationPrs),
      liveEvaluated: asNumber(row.liveEvaluated),
    }))
    .filter((row) => row.sourceKind);

  return {
    totalCandidates: asNumber(audit.totalCandidates),
    watch: asNumber(audit.watch),
    rejected: asNumber(audit.rejected),
    accepted: asNumber(audit.accepted),
    acceptedDraftPrs: asNumber(audit.acceptedDraftPrs),
    implementationPrs: asNumber(audit.implementationPrs),
    liveEvaluated: asNumber(audit.liveEvaluated),
    dueForReevaluation: asArray(audit.dueForReevaluation).length,
    repeatedWatch: asArray(audit.repeatedWatch).length,
    watchBottlenecks,
    bySourceKind,
  };
}

function countReadiness(plans: unknown): MemoryResearchAdminReadinessCounts {
  const result: MemoryResearchAdminReadinessCounts = {
    readyDeterministic: 0,
    readyDurableLedger: 0,
    readyMutationLifecycle: 0,
    mixedOwner: 0,
    harnessExtensionRequired: 0,
    noPortRequired: 0,
  };
  for (const raw of asArray(plans)) {
    const plan = asRecord(raw);
    if (!plan) continue;
    const readiness = asString(plan.readiness);
    if (readiness === "READY_DETERMINISTIC_FIXTURE") result.readyDeterministic += 1;
    else if (readiness === "READY_DURABLE_LEDGER_FIXTURE") result.readyDurableLedger += 1;
    else if (readiness === "READY_MUTATION_LIFECYCLE_FIXTURE") {
      result.readyMutationLifecycle += 1;
    } else if (readiness === "MIXED_OWNER_PLAN") result.mixedOwner += 1;
    else if (readiness === "HARNESS_EXTENSION_REQUIRED") {
      result.harnessExtensionRequired += 1;
    } else if (readiness === "NO_PORT_REQUIRED") result.noPortRequired += 1;

    for (const rawSubplan of asArray(plan.subplans)) {
      const subplan = asRecord(rawSubplan);
      if (!subplan) continue;
      const subReadiness = asString(subplan.readiness);
      if (subReadiness === "READY_DETERMINISTIC_FIXTURE") result.readyDeterministic += 1;
      else if (subReadiness === "READY_DURABLE_LEDGER_FIXTURE") {
        result.readyDurableLedger += 1;
      } else if (subReadiness === "READY_MUTATION_LIFECYCLE_FIXTURE") {
        result.readyMutationLifecycle += 1;
      } else if (subReadiness === "HARNESS_EXTENSION_REQUIRED") {
        result.harnessExtensionRequired += 1;
      } else if (subReadiness === "NO_PORT_REQUIRED") result.noPortRequired += 1;
    }
  }
  return result;
}

export function projectMemoryResearchAdminRun(
  rawCycle: string | null
): MemoryResearchAdminRun | null {
  const cycle = parseJsonRecord(rawCycle);
  if (!cycle) return null;

  const cycleKey = asString(cycle.cycleKey);
  const finishedAt = asString(cycle.finishedAt);
  if (!cycleKey || !finishedAt) return null;

  const counts = asRecord(cycle.counts) ?? {};
  const providerCalls = asRecord(cycle.providerCalls) ?? {};
  const gate = asRecord(cycle.baselinePromotionGate);
  const casePortPlans = asArray(cycle.benchmarkCasePortPlans);
  const persistentMemoryGapReport = asRecord(cycle.persistentMemoryGaps);
  const persistentGapRows = asArray(
    persistentMemoryGapReport?.persistentGaps
  );
  const insights = projectMemoryResearchInsights(cycle);
  const decisions = asArray(cycle.decisions)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => ({
      candidateKey: asString(row.candidateKey),
      decision: asString(row.decision),
      reason: asString(row.reason),
    }))
    .filter((row) => row.candidateKey && row.decision);

  const priorityDecisions = decisions.filter(
    (row) =>
      row.decision.startsWith("ACCEPTED_") ||
      row.decision.startsWith("WATCH_")
  );

  return {
    cycleKey,
    mode: asString(cycle.mode) || "unknown",
    status: asString(cycle.status) || "unknown",
    finishedAt,
    mainSha: asString(cycle.mainSha),
    counts: {
      sourcesChecked: asNumber(counts.sourcesChecked),
      sourcesFailed: asNumber(counts.sourcesFailed),
      observations: asNumber(counts.observations),
      newCandidates: asNumber(counts.newCandidates),
      evaluated: asNumber(counts.evaluated),
      watch: asNumber(counts.watch),
      reject: asNumber(counts.reject),
      benchmarked: asNumber(counts.benchmarked),
      accept: asNumber(counts.accept),
      draftPrPackets: asNumber(counts.draftPrPackets),
    },
    paidProviderCalls: asNumber(providerCalls.paidProviderCalls),
    httpCalls: asNumber(providerCalls.httpCalls),
    httpBudget: asNumber(providerCalls.httpBudget),
    estimatedCostUsd: asNumber(cycle.estimatedCostUsd),
    productionTouched: cycle.productionTouched === true,
    baselinePromotionGateStatus: gate
      ? asString(gate.status) || null
      : null,
    baselinePromotionBlocked: gate ? asBoolean(gate.blocked) : null,
    companionExperimentProposals: asArray(
      cycle.companionExperimentProposals
    ).length,
    benchmarkAdoptionProposals: asArray(
      cycle.benchmarkAdoptionProposals
    ).length,
    benchmarkCasePortPlans: casePortPlans.length,
    benchmarkHarnessFeasibility: asArray(
      cycle.benchmarkHarnessFeasibility
    ).length,
    localGoldAuthoringPackets: asArray(cycle.localGoldAuthoringPackets).length,
    persistentMemoryGaps: persistentGapRows.length,
    persistentMemoryGapStatus: persistentMemoryGapReport
      ? asString(persistentMemoryGapReport.status) || null
      : null,
    promptPackingAudit: projectPromptPackingAudit(cycle.promptPackingAudit),
    promptPackingTrend: projectPromptPackingTrend(cycle.promptPackingTrend),
    readiness: countReadiness(casePortPlans),
    insights,
    effectiveness: projectMemoryResearchEffectiveness(cycle.effectivenessAudit),
    decisions: (priorityDecisions.length > 0 ? priorityDecisions : decisions).slice(
      0,
      8
    ),
  };
}

export function assessMemoryResearchFreshness(
  run: MemoryResearchAdminRun | null,
  workflowGroup: GithubScheduledAutomationGroup | null,
  now = new Date()
): {
  status: MemoryResearchFreshnessStatus;
  reason: string | null;
} {
  if (!run) {
    return {
      status: "UNKNOWN",
      reason: "Persisted Memory Research cycle is not available.",
    };
  }

  const finishedAtMs = Date.parse(run.finishedAt);
  if (!Number.isFinite(finishedAtMs)) {
    return {
      status: "UNKNOWN",
      reason: "Persisted Memory Research finishedAt is invalid.",
    };
  }

  const latestScheduled = workflowGroup?.latest ?? null;
  const latestRunUpdatedAtMs = latestScheduled?.updatedAt
    ? Date.parse(latestScheduled.updatedAt)
    : Number.NaN;

  if (
    latestScheduled?.conclusion === "success" &&
    Number.isFinite(latestRunUpdatedAtMs) &&
    latestRunUpdatedAtMs >
      finishedAtMs + MEMORY_RESEARCH_PERSISTENCE_LAG_TOLERANCE_MS
  ) {
    return {
      status: "PERSISTENCE_LAG",
      reason:
        "A newer successful scheduled Memory Research run exists, but its durable cycle report is not the latest persisted report.",
    };
  }

  const ageMs = now.getTime() - finishedAtMs;
  if (Number.isFinite(ageMs) && ageMs > MEMORY_RESEARCH_STALE_AFTER_MS) {
    return {
      status: "STALE_CYCLE",
      reason:
        "The latest persisted Memory Research cycle is older than the allowed weekly freshness window.",
    };
  }

  return {
    status: "FRESH",
    reason: null,
  };
}

export async function fetchMemoryResearchAdminProjection(
  githubGroups: readonly GithubScheduledAutomationGroup[],
  fetchImpl: typeof fetch = fetch,
  repo = AUTOMATION_REPORTS_GITHUB_REPO,
  now = new Date()
): Promise<MemoryResearchAdminProjection> {
  const workflowGroup =
    githubGroups.find((group) => group.path === MEMORY_RESEARCH_WORKFLOW_PATH) ??
    null;
  const githubRunUrl = workflowGroup?.latest.htmlUrl ?? null;

  const ledger = await githubReportGetContent(
    `https://api.github.com/repos/${repo}/contents/ledger.json?ref=${MEMORY_RESEARCH_LEDGER_BRANCH}`,
    fetchImpl
  );
  if (ledger.status !== "OK") {
    return {
      status: ledger.status,
      error: ledger.error,
      run: null,
      githubRunUrl,
      persistedReportUrl: null,
      freshnessStatus: "UNKNOWN",
      freshnessReason: ledger.error ?? "Persisted Memory Research report is unavailable.",
      pipeline: EMPTY_PIPELINE,
    };
  }

  const pipeline = projectMemoryResearchAdminPipeline(ledger.raw);
  const cycleKey = latestCycleKeyFromLedger(ledger.raw);
  if (!cycleKey) {
    return {
      status: "EMPTY",
      error: null,
      run: null,
      githubRunUrl,
      persistedReportUrl: null,
      freshnessStatus: "UNKNOWN",
      freshnessReason: "No persisted Memory Research cycle is available yet.",
      pipeline,
    };
  }

  const cycle = await githubReportGetContent(
    `https://api.github.com/repos/${repo}/contents/cycles/${encodeURIComponent(
      cycleKey
    )}.json?ref=${MEMORY_RESEARCH_LEDGER_BRANCH}`,
    fetchImpl
  );
  if (cycle.status !== "OK") {
    return {
      status: cycle.status,
      error: cycle.error,
      run: null,
      githubRunUrl,
      persistedReportUrl: null,
      freshnessStatus: "UNKNOWN",
      freshnessReason: cycle.error ?? "Persisted Memory Research cycle is unavailable.",
      pipeline,
    };
  }

  const run = projectMemoryResearchAdminRun(cycle.raw);
  if (!run) {
    return {
      status: "UNAVAILABLE",
      error: "Malformed memory research cycle report",
      run: null,
      githubRunUrl,
      persistedReportUrl: null,
      freshnessStatus: "UNKNOWN",
      freshnessReason: "Persisted Memory Research cycle is malformed.",
      pipeline,
    };
  }

  const freshness = assessMemoryResearchFreshness(run, workflowGroup, now);

  return {
    status: "OK",
    error: null,
    run,
    githubRunUrl,
    persistedReportUrl:
      `https://github.com/${repo}/blob/${MEMORY_RESEARCH_LEDGER_BRANCH}/cycles/${encodeURIComponent(
        cycleKey
      )}.json`,
    freshnessStatus: freshness.status,
    freshnessReason: freshness.reason,
    pipeline,
  };
}
