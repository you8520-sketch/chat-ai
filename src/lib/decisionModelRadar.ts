import { createHash } from "node:crypto";

export const DECISION_RADAR_VERSION = 1;
export const DECISION_RADAR_BASELINE_MODEL = "typesafe/jev-1.13";
export const DECISION_RADAR_LEDGER_BRANCH = "decision-model-radar-ledger";
export const DECISION_RADAR_WORKFLOW_PATH = ".github/workflows/decision-model-radar-weekly.yml";
export const DECISION_RADAR_MAX_CANDIDATES_PER_RUN = 3;

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function perTokenToPerMillion(value: unknown): number | null {
  const parsed = num(value);
  return parsed == null ? null : parsed * 1_000_000;
}
function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type DecisionCatalogModel = {
  id: string;
  canonicalSlug: string | null;
  name: string;
  created: number | null;
  description: string;
  contextLength: number | null;
  promptUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  fingerprint: string;
};

export type DecisionSuiteSummary = {
  suite: string;
  total: number;
  correct: number;
  accuracy: number | null;
  criticalMisses: number;
  malformed: number;
  failures: number;
};

export type DecisionBenchmarkSummary = {
  model: string;
  total: number;
  correct: number;
  accuracy: number | null;
  criticalMisses: number;
  malformed: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number | null;
  latencyMs: {
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
  bySuite: DecisionSuiteSummary[];
};

export type DecisionCandidateEvaluation = {
  model: string;
  fingerprint: string;
  globalReplacementCandidate: boolean;
  suiteCandidates: string[];
  summary: DecisionBenchmarkSummary;
  baseline: DecisionBenchmarkSummary;
};

export type DecisionRadarRun = {
  ranAt: string;
  mainSha: string;
  status: "NO_CHANGE" | "BENCHMARKED" | "REVIEW_CANDIDATE" | "PARTIAL" | "FAILED";
  discoveredModels: number;
  changedCandidates: string[];
  benchmarkedCandidates: string[];
  deferredCandidates: string[];
  providerCalls: number;
  baseline: DecisionBenchmarkSummary | null;
  evaluations: DecisionCandidateEvaluation[];
  notes: string[];
  githubRunUrl: string | null;
};

export type DecisionRadarLedger = {
  version: 1;
  models: Record<
    string,
    {
      fingerprint: string;
      lastSeenAt: string;
      lastBenchmarkedAt: string | null;
      lastSummary: DecisionBenchmarkSummary | null;
    }
  >;
  runs: DecisionRadarRun[];
};

export function emptyDecisionRadarLedger(): DecisionRadarLedger {
  return { version: 1, models: {}, runs: [] };
}

export function parseDecisionRadarLedger(raw: string | null | undefined): DecisionRadarLedger {
  if (!raw?.trim()) return emptyDecisionRadarLedger();
  try {
    const parsed = JSON.parse(raw) as Partial<DecisionRadarLedger>;
    return {
      version: 1,
      models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
      runs: Array.isArray(parsed.runs) ? parsed.runs.slice(-52) : [],
    };
  } catch {
    return emptyDecisionRadarLedger();
  }
}

function looksLikeAliasOrRouter(model: DecisionCatalogModel): boolean {
  const id = model.id.toLowerCase();
  const description = model.description.toLowerCase();
  return (
    id.includes("router") ||
    id.endsWith("-latest") ||
    id.includes("/jev-latest") ||
    description.includes("always redirects to the latest")
  );
}

export function parseDecisionCatalog(payload: unknown): DecisionCatalogModel[] {
  const root = asObj(payload);
  const data = Array.isArray(root?.data) ? root!.data : [];
  const out: DecisionCatalogModel[] = [];

  for (const raw of data) {
    const row = asObj(raw);
    if (!row) continue;
    const id = str(row.id);
    if (!id) continue;
    const pricing = asObj(row.pricing) ?? {};
    const model: DecisionCatalogModel = {
      id,
      canonicalSlug: str(row.canonical_slug),
      name: str(row.name) ?? id,
      created: num(row.created),
      description: str(row.description) ?? "",
      contextLength: num(row.context_length),
      promptUsdPerMillion: perTokenToPerMillion(pricing.prompt),
      outputUsdPerMillion: perTokenToPerMillion(pricing.completion),
      fingerprint: "",
    };
    model.fingerprint = sha({
      id: model.id,
      canonicalSlug: model.canonicalSlug,
      created: model.created,
      description: model.description,
      contextLength: model.contextLength,
      promptUsdPerMillion: model.promptUsdPerMillion,
      outputUsdPerMillion: model.outputUsdPerMillion,
    });
    out.push(model);
  }

  return out
    .filter((model) => !looksLikeAliasOrRouter(model))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

export function selectChangedDecisionCandidates(input: {
  catalog: readonly DecisionCatalogModel[];
  ledger: DecisionRadarLedger;
  baselineModel?: string;
  maxCandidates?: number;
}): {
  changed: DecisionCatalogModel[];
  selected: DecisionCatalogModel[];
  deferred: DecisionCatalogModel[];
} {
  const baselineModel = input.baselineModel ?? DECISION_RADAR_BASELINE_MODEL;
  const maxCandidates = input.maxCandidates ?? DECISION_RADAR_MAX_CANDIDATES_PER_RUN;
  const changed = input.catalog.filter((model) => {
    if (model.id === baselineModel) return false;
    const prior = input.ledger.models[model.id];
    return !prior || prior.fingerprint !== model.fingerprint;
  });
  return {
    changed,
    selected: changed.slice(0, maxCandidates),
    deferred: changed.slice(maxCandidates),
  };
}

function suiteMap(summary: DecisionBenchmarkSummary): Map<string, DecisionSuiteSummary> {
  return new Map(summary.bySuite.map((suite) => [suite.suite, suite]));
}

export function evaluateDecisionCandidate(
  baseline: DecisionBenchmarkSummary,
  candidate: DecisionBenchmarkSummary,
  fingerprint: string
): DecisionCandidateEvaluation {
  const baselineSuites = suiteMap(baseline);
  const candidateSuites = suiteMap(candidate);
  const suiteCandidates: string[] = [];

  for (const [suiteName, candidateSuite] of candidateSuites) {
    const baselineSuite = baselineSuites.get(suiteName);
    if (!baselineSuite) continue;
    if (
      candidateSuite.failures === 0 &&
      candidateSuite.malformed === 0 &&
      candidateSuite.accuracy != null &&
      baselineSuite.accuracy != null &&
      candidateSuite.accuracy > baselineSuite.accuracy &&
      candidateSuite.criticalMisses <= baselineSuite.criticalMisses
    ) {
      suiteCandidates.push(suiteName);
    }
  }

  const globalReplacementCandidate =
    candidate.failures === 0 &&
    candidate.malformed === 0 &&
    candidate.accuracy != null &&
    baseline.accuracy != null &&
    candidate.accuracy > baseline.accuracy &&
    candidate.criticalMisses <= baseline.criticalMisses;

  return {
    model: candidate.model,
    fingerprint,
    globalReplacementCandidate,
    suiteCandidates,
    summary: candidate,
    baseline,
  };
}

export function upsertDecisionRadarLedger(input: {
  ledger: DecisionRadarLedger;
  catalog: readonly DecisionCatalogModel[];
  run: DecisionRadarRun;
}): DecisionRadarLedger {
  const next: DecisionRadarLedger = {
    version: 1,
    models: { ...input.ledger.models },
    runs: [...input.ledger.runs, input.run].slice(-52),
  };
  const now = input.run.ranAt;
  const summaries = new Map<string, DecisionBenchmarkSummary>();
  if (input.run.baseline) summaries.set(input.run.baseline.model, input.run.baseline);
  for (const evaluation of input.run.evaluations) {
    summaries.set(evaluation.model, evaluation.summary);
  }

  for (const model of input.catalog) {
    const previous = next.models[model.id];
    const benchmarked = summaries.get(model.id) ?? null;
    next.models[model.id] = {
      fingerprint: model.fingerprint,
      lastSeenAt: now,
      lastBenchmarkedAt: benchmarked ? now : previous?.lastBenchmarkedAt ?? null,
      lastSummary: benchmarked ?? previous?.lastSummary ?? null,
    };
  }
  return next;
}

export function latestDecisionRadarRun(ledger: DecisionRadarLedger): DecisionRadarRun | null {
  return ledger.runs.length ? ledger.runs[ledger.runs.length - 1]! : null;
}
