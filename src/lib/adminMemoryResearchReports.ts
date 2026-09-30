import {
  AUTOMATION_REPORTS_GITHUB_REPO,
  type GithubScheduledAutomationGroup,
} from "@/lib/adminAutomationReports";

export const MEMORY_RESEARCH_LEDGER_BRANCH = "memory-research-ledger";
export const MEMORY_RESEARCH_WORKFLOW_PATH =
  ".github/workflows/memory-research-cycle.yml";

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

export type MemoryResearchAdminDecision = {
  candidateKey: string;
  decision: string;
  reason: string;
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
  readiness: MemoryResearchAdminReadinessCounts;
  decisions: MemoryResearchAdminDecision[];
};

export type MemoryResearchAdminProjection = {
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  run: MemoryResearchAdminRun | null;
  githubRunUrl: string | null;
  persistedReportUrl: string | null;
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

function decodeGithubContent(body: unknown): string | null {
  const record = asRecord(body);
  const content = record ? asString(record.content) : "";
  if (!content) return null;
  try {
    return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
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
    persistentMemoryGaps: asArray(cycle.persistentMemoryGaps).length,
    readiness: countReadiness(casePortPlans),
    decisions: (priorityDecisions.length > 0 ? priorityDecisions : decisions).slice(
      0,
      8
    ),
  };
}

async function fetchGithubContentRaw(
  url: string,
  fetchImpl: typeof fetch
): Promise<{
  status: "OK" | "EMPTY" | "UNAVAILABLE";
  error: string | null;
  raw: string | null;
}> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "chat-ai-admin-automation-reports",
      },
      cache: "no-store",
    });
    if (response.status === 404) {
      return { status: "EMPTY", error: null, raw: null };
    }
    if (!response.ok) {
      return {
        status: "UNAVAILABLE",
        error: `GitHub Contents API ${response.status}`,
        raw: null,
      };
    }
    const raw = decodeGithubContent(await response.json());
    return raw
      ? { status: "OK", error: null, raw }
      : { status: "EMPTY", error: null, raw: null };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error:
        error instanceof Error
          ? error.message
          : "Memory research ledger unavailable",
      raw: null,
    };
  }
}

export async function fetchMemoryResearchAdminProjection(
  githubGroups: readonly GithubScheduledAutomationGroup[],
  fetchImpl: typeof fetch = fetch,
  repo = AUTOMATION_REPORTS_GITHUB_REPO
): Promise<MemoryResearchAdminProjection> {
  const workflowGroup =
    githubGroups.find((group) => group.path === MEMORY_RESEARCH_WORKFLOW_PATH) ??
    null;
  const githubRunUrl = workflowGroup?.latest.htmlUrl ?? null;

  const ledger = await fetchGithubContentRaw(
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
    };
  }

  const cycleKey = latestCycleKeyFromLedger(ledger.raw);
  if (!cycleKey) {
    return {
      status: "EMPTY",
      error: null,
      run: null,
      githubRunUrl,
      persistedReportUrl: null,
    };
  }

  const cycle = await fetchGithubContentRaw(
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
    };
  }

  return {
    status: "OK",
    error: null,
    run,
    githubRunUrl,
    persistedReportUrl:
      `https://github.com/${repo}/blob/${MEMORY_RESEARCH_LEDGER_BRANCH}/cycles/${encodeURIComponent(
        cycleKey
      )}.json`,
  };
}
