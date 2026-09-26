/**
 * Two-stage scene-boundary shadow benchmark:
 *   lexical scanner (candidate) → bounded JEV semantic verdict (judge).
 *
 * Read-only QA metrics only. No RP regeneration, no DB writes, no production
 * enforcement. Without triple opt-in: NOT_RUN, provider calls = 0.
 */
import {
  callJevDecisions,
  JEV_DECISIONS_MODEL,
} from "@/lib/jevDecisions";
import {
  scanR5BoundarySuspicionSignals,
  type BoundarySuspicionSignal,
} from "@/lib/scenePolicyBoundarySuspicionScan";
import {
  SCENE_BOUNDARY_SEMANTIC_CORPUS,
  type SceneBoundarySemanticFixture,
  type SceneBoundarySemanticVerdict,
} from "@/lib/sceneBoundarySemanticCorpus";
import {
  assertSceneBoundaryJevStateHasNoPrivateIdentifiers,
  buildSceneBoundaryJevQuestions,
  buildSceneBoundaryJevStateFromFixture,
  parseSceneBoundaryJevVerdict,
} from "@/lib/sceneBoundaryJevJudge";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_SCENE_BOUNDARY_PROBE_ENV,
  resolveOptInJevSceneBoundaryBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";

export type SceneBoundaryFixtureScanRow = {
  fixtureId: string;
  expectedVerdict: SceneBoundarySemanticVerdict;
  expectScannerCandidate: boolean;
  scannerSignals: BoundarySuspicionSignal[];
  scannerPositive: boolean;
};

export type SceneBoundaryFixtureJevRow = {
  fixtureId: string;
  expectedVerdict: SceneBoundarySemanticVerdict;
  scannerSignals: BoundarySuspicionSignal[];
  verdict: SceneBoundarySemanticVerdict | null;
  malformed: boolean;
  failure: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  model: string;
  providerCallAttempted: boolean;
};

export type SceneBoundaryLexicalMetrics = {
  totalFixtures: number;
  candidateHitCount: number;
  missedTrueViolations: number;
  benignCompliantCandidateCount: number;
  perSignalCandidateCounts: Record<BoundarySuspicionSignal, number>;
  rows: SceneBoundaryFixtureScanRow[];
};

export type SceneBoundaryJevMetrics = {
  calledFixtures: number;
  providerCalls: number;
  violationCount: number;
  compliantCount: number;
  insufficientContextCount: number;
  malformedCount: number;
  failureCount: number;
  humanLabelAgreementCount: number;
  falseViolationCount: number;
  missedViolationAmongCalled: number;
  inputTokens: number;
  outputTokens: number;
  actualProviderCostUsd: number | null;
  latencyMs: { p50: number | null; p95: number | null; max: number | null; count: number };
  model: string;
  provider: string;
  rows: SceneBoundaryFixtureJevRow[];
};

export type SceneBoundaryCombinedMetrics = {
  trueViolationAlerts: number;
  compliantFalseAlerts: number;
  trueViolationsMissedByScanner: number;
  trueViolationsMissedByJev: number;
  insufficientContextCases: number;
  disagreementFixtureIds: string[];
};

export type SceneBoundaryBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | {
      status: "RAN";
      corpusSize: number;
      lexical: SceneBoundaryLexicalMetrics;
      jev: SceneBoundaryJevMetrics;
      combined: SceneBoundaryCombinedMetrics;
      totalProviderCalls: number;
      productionEnforcementEnabled: false;
    };

function summarizeLatency(values: number[]): SceneBoundaryJevMetrics["latencyMs"] {
  if (values.length === 0) return { p50: null, p95: null, max: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10;
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(sorted[sorted.length - 1]! * 10) / 10,
    count: values.length,
  };
}

function emptySignalCounts(): Record<BoundarySuspicionSignal, number> {
  return {
    physical_revisit: 0,
    remote_contact: 0,
    gift_drop_off: 0,
    future_meeting_request: 0,
    boundary_clarification: 0,
    relationship_closure_demand: 0,
  };
}

export function scanCorpusLexically(
  fixtures: readonly SceneBoundarySemanticFixture[] = SCENE_BOUNDARY_SEMANTIC_CORPUS
): SceneBoundaryLexicalMetrics {
  const perSignalCandidateCounts = emptySignalCounts();
  const rows: SceneBoundaryFixtureScanRow[] = [];
  let candidateHitCount = 0;
  let missedTrueViolations = 0;
  let benignCompliantCandidateCount = 0;

  for (const fixture of fixtures) {
    const flags = scanR5BoundarySuspicionSignals(fixture.assistantOutput);
    const scannerSignals = (Object.keys(flags) as BoundarySuspicionSignal[]).filter((k) => flags[k]);
    const scannerPositive = scannerSignals.length > 0;
    if (scannerPositive) {
      candidateHitCount += 1;
      for (const s of scannerSignals) perSignalCandidateCounts[s] += 1;
      if (fixture.expectedVerdict === "COMPLIANT") benignCompliantCandidateCount += 1;
    } else if (fixture.expectedVerdict === "VIOLATION") {
      missedTrueViolations += 1;
    }
    rows.push({
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      expectScannerCandidate: fixture.expectScannerCandidate,
      scannerSignals,
      scannerPositive,
    });
  }

  return {
    totalFixtures: fixtures.length,
    candidateHitCount,
    missedTrueViolations,
    benignCompliantCandidateCount,
    perSignalCandidateCounts,
    rows,
  };
}

async function judgeFixture(opts: {
  fixture: SceneBoundarySemanticFixture;
  scannerSignals: BoundarySuspicionSignal[];
  apiKey: string;
}): Promise<SceneBoundaryFixtureJevRow> {
  const { fixture, scannerSignals, apiKey } = opts;
  const state = buildSceneBoundaryJevStateFromFixture(fixture, scannerSignals);
  const leak = assertSceneBoundaryJevStateHasNoPrivateIdentifiers(
    state as unknown as Record<string, unknown>
  );
  const started = performance.now();
  try {
    if (leak.length) {
      throw new Error(`jev_state_invariant_violation:${leak.join(",")}`);
    }
    const result = await callJevDecisions({
      state,
      questions: buildSceneBoundaryJevQuestions(),
      apiKey,
      ledger: null,
      timeoutMs: 60_000,
    });
    const verdict = parseSceneBoundaryJevVerdict(
      result.answers as Record<string, { type?: string; choice?: string }>
    );
    const malformed = verdict == null;
    return {
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      scannerSignals,
      verdict,
      malformed,
      failure: malformed ? "jev_malformed_or_unmappable" : null,
      latencyMs: performance.now() - started,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      actualCostUsd: result.usage.upstreamCostUsd ?? null,
      model: result.responseModel || JEV_DECISIONS_MODEL,
      providerCallAttempted: true,
    };
  } catch (e) {
    return {
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      scannerSignals,
      verdict: null,
      malformed: true,
      failure: sanitizeJevBenchmarkCredentialText((e as Error).message).slice(0, 240),
      latencyMs: performance.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      actualCostUsd: null,
      model: JEV_DECISIONS_MODEL,
      providerCallAttempted: true,
    };
  }
}

function aggregateJev(rows: SceneBoundaryFixtureJevRow[]): SceneBoundaryJevMetrics {
  const called = rows.filter((r) => r.providerCallAttempted);
  const costs = called.map((r) => r.actualCostUsd).filter((c): c is number => c != null);
  let agreement = 0;
  let falseViolation = 0;
  let missedViolation = 0;
  for (const row of called) {
    if (row.verdict == null) continue;
    if (row.verdict === row.expectedVerdict) agreement += 1;
    if (row.verdict === "VIOLATION" && row.expectedVerdict !== "VIOLATION") falseViolation += 1;
    if (row.expectedVerdict === "VIOLATION" && row.verdict !== "VIOLATION") missedViolation += 1;
  }
  return {
    calledFixtures: called.length,
    providerCalls: called.length,
    violationCount: called.filter((r) => r.verdict === "VIOLATION").length,
    compliantCount: called.filter((r) => r.verdict === "COMPLIANT").length,
    insufficientContextCount: called.filter((r) => r.verdict === "INSUFFICIENT_CONTEXT").length,
    malformedCount: called.filter((r) => r.malformed).length,
    failureCount: called.filter((r) => r.failure != null).length,
    humanLabelAgreementCount: agreement,
    falseViolationCount: falseViolation,
    missedViolationAmongCalled: missedViolation,
    inputTokens: called.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: called.reduce((s, r) => s + r.outputTokens, 0),
    actualProviderCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    latencyMs: summarizeLatency(called.map((r) => r.latencyMs)),
    model: JEV_DECISIONS_MODEL,
    provider: "openrouter-decisions",
    rows,
  };
}

function combineMetrics(
  fixtures: readonly SceneBoundarySemanticFixture[],
  lexical: SceneBoundaryLexicalMetrics,
  jev: SceneBoundaryJevMetrics
): SceneBoundaryCombinedMetrics {
  const scanById = new Map(lexical.rows.map((r) => [r.fixtureId, r]));
  const jevById = new Map(jev.rows.map((r) => [r.fixtureId, r]));
  let trueViolationAlerts = 0;
  let compliantFalseAlerts = 0;
  let trueViolationsMissedByScanner = 0;
  let trueViolationsMissedByJev = 0;
  let insufficientContextCases = 0;
  const disagreementFixtureIds: string[] = [];

  for (const fixture of fixtures) {
    const scan = scanById.get(fixture.id)!;
    const judged = jevById.get(fixture.id);
    const alert = Boolean(scan.scannerPositive && judged?.verdict === "VIOLATION");

    if (fixture.expectedVerdict === "INSUFFICIENT_CONTEXT") {
      insufficientContextCases += 1;
    }
    if (fixture.expectedVerdict === "VIOLATION") {
      if (!scan.scannerPositive) {
        trueViolationsMissedByScanner += 1;
        disagreementFixtureIds.push(fixture.id);
      } else if (judged?.verdict !== "VIOLATION") {
        trueViolationsMissedByJev += 1;
        disagreementFixtureIds.push(fixture.id);
      } else if (alert) {
        trueViolationAlerts += 1;
      }
    } else if (fixture.expectedVerdict === "COMPLIANT" && alert) {
      compliantFalseAlerts += 1;
      disagreementFixtureIds.push(fixture.id);
    } else if (judged && judged.verdict != null && judged.verdict !== fixture.expectedVerdict) {
      disagreementFixtureIds.push(fixture.id);
    } else if (judged?.malformed) {
      disagreementFixtureIds.push(fixture.id);
    }
  }

  return {
    trueViolationAlerts,
    compliantFalseAlerts,
    trueViolationsMissedByScanner,
    trueViolationsMissedByJev,
    insufficientContextCases,
    disagreementFixtureIds: [...new Set(disagreementFixtureIds)],
  };
}

/**
 * Deterministic lexical-only pass (no HTTP). Used by tests and as the first
 * stage of the live runner.
 */
export function runSceneBoundaryLexicalStage(
  fixtures: readonly SceneBoundarySemanticFixture[] = SCENE_BOUNDARY_SEMANTIC_CORPUS
): SceneBoundaryLexicalMetrics {
  return scanCorpusLexically(fixtures);
}

export async function runSceneBoundaryJevBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fixtures?: readonly SceneBoundarySemanticFixture[];
  /** Test seam: inject a fake judge instead of HTTP. */
  judgeFixture?: typeof judgeFixture;
} = {}): Promise<SceneBoundaryBenchmarkResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? process.env;
  const apiKey = resolveOptInJevSceneBoundaryBenchmarkApiKey(env);
  const fixtures = opts.fixtures ?? SCENE_BOUNDARY_SEMANTIC_CORPUS;

  if (!apiKey) {
    const missing: string[] = [];
    if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") missing.push("REGULAR_TEST_REAL_PROVIDER_CALLS=1");
    if (env[REAL_JEV_SCENE_BOUNDARY_PROBE_ENV] !== "1") {
      missing.push(`${REAL_JEV_SCENE_BOUNDARY_PROBE_ENV}=1`);
    }
    if (!env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim()) missing.push(OPENROUTER_JEV_BENCHMARK_ENV);
    const reason = `triple opt-in absent (${missing.join(", ") || "benchmark credentials"})`;
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const lexical = scanCorpusLexically(fixtures);
  const judge = opts.judgeFixture ?? judgeFixture;
  const jevRows: SceneBoundaryFixtureJevRow[] = [];

  for (const row of lexical.rows) {
    if (!row.scannerPositive) continue;
    const fixture = fixtures.find((f) => f.id === row.fixtureId)!;
    jevRows.push(
      await judge({
        fixture,
        scannerSignals: row.scannerSignals,
        apiKey,
      })
    );
  }

  const jev = aggregateJev(jevRows);
  const combined = combineMetrics(fixtures, lexical, jev);
  const result: SceneBoundaryBenchmarkResult = {
    status: "RAN",
    corpusSize: fixtures.length,
    lexical,
    jev,
    combined,
    totalProviderCalls: jev.providerCalls,
    productionEnforcementEnabled: false,
  };
  log(JSON.stringify(result));
  return result;
}
