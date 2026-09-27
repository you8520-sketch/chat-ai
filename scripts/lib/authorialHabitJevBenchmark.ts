/**
 * Authorial Habit lexical→JEV semantic benchmark.
 *
 * Existing regex audit remains the deterministic candidate owner.
 * JEV is benchmark-only semantic refinement and never changes prompts/output.
 */
import {
  callJevDecisions,
  JevDecisionsError,
  JEV_DECISIONS_MODEL,
} from "@/lib/jevDecisions";
import {
  AUTHORIAL_HABIT_JEV_CORPUS,
  type AuthorialHabitJevFixture,
  type AuthorialHabitSemanticVerdict,
} from "@/lib/authorialHabitJevCorpus";
import {
  assertAuthorialHabitJevStateHasNoPrivateIdentifiers,
  buildAuthorialHabitJevQuestions,
  buildAuthorialHabitJevState,
  evaluateAuthorialHabitCandidate,
  parseAuthorialHabitJevVerdict,
  type AuthorialHabitLexicalSignals,
} from "@/lib/authorialHabitJevJudge";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV,
  resolveOptInJevAuthorialHabitBenchmarkApiKey,
  sanitizeAuthorialHabitBenchmarkCredentialText,
  withIsolatedAuthorialHabitBenchmarkOpenRouterKey,
} from "./authorialHabitJevBenchmarkCredential";

export type AuthorialHabitScanRow = {
  fixtureId: string;
  expectedVerdict: AuthorialHabitSemanticVerdict;
  candidate: boolean;
  signals: AuthorialHabitLexicalSignals;
};

export type AuthorialHabitJevRow = {
  fixtureId: string;
  expectedVerdict: AuthorialHabitSemanticVerdict;
  verdict: AuthorialHabitSemanticVerdict | null;
  malformed: boolean;
  failure: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  model: string;
  providerCallAttempted: boolean;
  choiceConfidence?: number | null;
  choiceProbabilities?: Partial<Record<AuthorialHabitSemanticVerdict, number>> | null;
};

export type AuthorialHabitLexicalMetrics = {
  totalFixtures: number;
  candidateCount: number;
  scannerMissCount: number;
  candidateLabelCounts: Record<AuthorialHabitSemanticVerdict, number>;
  rows: AuthorialHabitScanRow[];
};

export type AuthorialHabitJevMetrics = {
  evaluatedFixtures: number;
  calledFixtures: number;
  providerCalls: number;
  preflightFailureCount: number;
  habitPresentCount: number;
  contextuallyJustifiedCount: number;
  uncertainCount: number;
  unresolvedCount: number;
  malformedCount: number;
  failureCount: number;
  humanLabelAgreementCount: number;
  clearHabitMissCount: number;
  justifiedFalseHighPriorityCount: number;
  inputTokens: number;
  outputTokens: number;
  actualProviderCostUsd: number | null;
  reportedProviderCostUsd: number | null;
  actualProviderCostReportedCalls: number;
  actualProviderCostCoverage: "complete" | "partial" | "none";
  latencyMs: { p50: number | null; p95: number | null; max: number | null; count: number };
  model: string;
  provider: "openrouter-decisions";
  rows: AuthorialHabitJevRow[];
};

export type AuthorialHabitCombinedMetrics = {
  scannerOnlyReviewVolume: number;
  jevHighPriorityReviewVolume: number;
  jevNeedsReviewVolume: number;
  jevTotalReviewVolume: number;
  highPriorityReviewVolumeReductionVsScannerOnly: number | null;
  totalReviewVolumeReductionVsScannerOnly: number | null;
  trueHabitHighPriority: number;
  justifiedFalseHighPriority: number;
  clearHabitMissedByScanner: number;
  clearHabitMissedByJev: number;
  disagreementFixtureIds: string[];
};

export type AuthorialHabitJevBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | {
      status: "RAN";
      corpusSize: number;
      lexical: AuthorialHabitLexicalMetrics;
      jev: AuthorialHabitJevMetrics;
      combined: AuthorialHabitCombinedMetrics;
      totalProviderCalls: number;
      productionMutationEnabled: false;
      runtimeHookEnabled: false;
    };

function summarizeLatency(values: number[]): AuthorialHabitJevMetrics["latencyMs"] {
  if (values.length === 0) return { p50: null, p95: null, max: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return Math.round(sorted[index]! * 10) / 10;
  };
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: Math.round(sorted[sorted.length - 1]! * 10) / 10,
    count: sorted.length,
  };
}

export function scanAuthorialHabitCorpus(
  fixtures: readonly AuthorialHabitJevFixture[] = AUTHORIAL_HABIT_JEV_CORPUS
): AuthorialHabitLexicalMetrics {
  const rows: AuthorialHabitScanRow[] = [];
  const candidateLabelCounts: Record<AuthorialHabitSemanticVerdict, number> = {
    HABIT_PRESENT: 0,
    CONTEXTUALLY_JUSTIFIED: 0,
    UNCERTAIN: 0,
  };
  let candidateCount = 0;
  let scannerMissCount = 0;

  for (const fixture of fixtures) {
    const evaluated = evaluateAuthorialHabitCandidate(fixture);
    if (evaluated.candidate) {
      candidateCount += 1;
      candidateLabelCounts[fixture.expectedVerdict] += 1;
    } else {
      scannerMissCount += 1;
    }
    rows.push({
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      candidate: evaluated.candidate,
      signals: evaluated.signals,
    });
  }

  return {
    totalFixtures: fixtures.length,
    candidateCount,
    scannerMissCount,
    candidateLabelCounts,
    rows,
  };
}

export function assertAuthorialHabitCandidateLabelBalance(
  fixtures: readonly AuthorialHabitJevFixture[] = AUTHORIAL_HABIT_JEV_CORPUS
): {
  ok: boolean;
  habitPresent: number;
  justified: number;
  uncertain: number;
  candidateCount: number;
  detail: string;
} {
  const lexical = scanAuthorialHabitCorpus(fixtures);
  const habitPresent = lexical.candidateLabelCounts.HABIT_PRESENT;
  const justified = lexical.candidateLabelCounts.CONTEXTUALLY_JUSTIFIED;
  const uncertain = lexical.candidateLabelCounts.UNCERTAIN;
  const ok = habitPresent >= 6 && justified >= 6 && uncertain >= 3;
  return {
    ok,
    habitPresent,
    justified,
    uncertain,
    candidateCount: lexical.candidateCount,
    detail:
      `candidate labels HABIT=${habitPresent} JUSTIFIED=${justified} UNCERTAIN=${uncertain} (need >=6/6/3)`,
  };
}

async function judgeFixture(opts: {
  fixture: AuthorialHabitJevFixture;
  signals: AuthorialHabitLexicalSignals;
  benchmarkApiKey: string;
}): Promise<AuthorialHabitJevRow> {
  const state = buildAuthorialHabitJevState({
    fixture: opts.fixture,
    signals: opts.signals,
  });
  const privacyHits = assertAuthorialHabitJevStateHasNoPrivateIdentifiers(
    state as unknown as Record<string, unknown>
  );
  const started = performance.now();
  let providerCallAttempted = false;
  try {
    if (privacyHits.length > 0) {
      throw new Error(`jev_state_invariant_violation:${privacyHits.join(",")}`);
    }
    providerCallAttempted = true;
    const result = await withIsolatedAuthorialHabitBenchmarkOpenRouterKey(
      opts.benchmarkApiKey,
      () =>
        callJevDecisions({
          state,
          questions: buildAuthorialHabitJevQuestions(),
          ledger: null,
          timeoutMs: 60_000,
        })
    );
    const verdict = parseAuthorialHabitJevVerdict(
      result.answers as Record<string, { type?: string; choice?: string }>
    );
    const answer = result.answers.authorial_habit_verdict;
    const choiceConfidence =
      answer?.type === "choice" ? answer.confidence : null;
    const choiceProbabilities =
      answer?.type === "choice"
        ? {
            HABIT_PRESENT: answer.probabilities.HABIT_PRESENT,
            CONTEXTUALLY_JUSTIFIED:
              answer.probabilities.CONTEXTUALLY_JUSTIFIED,
            UNCERTAIN: answer.probabilities.UNCERTAIN,
          }
        : null;
    return {
      fixtureId: opts.fixture.id,
      expectedVerdict: opts.fixture.expectedVerdict,
      verdict,
      malformed: verdict == null,
      failure: verdict == null ? "jev_malformed_or_unmappable" : null,
      latencyMs: performance.now() - started,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      actualCostUsd: result.usage.upstreamCostUsd ?? null,
      model: result.responseModel || JEV_DECISIONS_MODEL,
      providerCallAttempted,
      choiceConfidence,
      choiceProbabilities,
    };
  } catch (error) {
    const malformed =
      error instanceof JevDecisionsError && error.code === "invalid_response";
    return {
      fixtureId: opts.fixture.id,
      expectedVerdict: opts.fixture.expectedVerdict,
      verdict: null,
      malformed,
      failure: sanitizeAuthorialHabitBenchmarkCredentialText(
        (error as Error).message || "jev_transport_error"
      ).slice(0, 240),
      latencyMs: performance.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      actualCostUsd: null,
      model: JEV_DECISIONS_MODEL,
      providerCallAttempted,
    };
  }
}

function aggregateJev(rows: AuthorialHabitJevRow[]): AuthorialHabitJevMetrics {
  const called = rows.filter((row) => row.providerCallAttempted);
  const costs = called
    .map((row) => row.actualCostUsd)
    .filter((value): value is number => value != null);
  let agreement = 0;
  let clearHabitMissCount = 0;
  let justifiedFalseHighPriorityCount = 0;

  for (const row of rows) {
    if (row.verdict === row.expectedVerdict) agreement += 1;
    if (
      row.expectedVerdict === "HABIT_PRESENT" &&
      row.verdict !== "HABIT_PRESENT"
    ) {
      clearHabitMissCount += 1;
    }
    if (
      row.expectedVerdict === "CONTEXTUALLY_JUSTIFIED" &&
      row.verdict === "HABIT_PRESENT"
    ) {
      justifiedFalseHighPriorityCount += 1;
    }
  }

  const actualProviderCostCoverage: AuthorialHabitJevMetrics["actualProviderCostCoverage"] =
    called.length === 0
      ? "none"
      : costs.length === called.length
        ? "complete"
        : costs.length > 0
          ? "partial"
          : "none";
  const reportedProviderCostUsd =
    costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null;

  return {
    evaluatedFixtures: rows.length,
    calledFixtures: called.length,
    providerCalls: called.length,
    preflightFailureCount: rows.filter(
      (row) => !row.providerCallAttempted && row.failure != null
    ).length,
    habitPresentCount: rows.filter((row) => row.verdict === "HABIT_PRESENT").length,
    contextuallyJustifiedCount: rows.filter(
      (row) => row.verdict === "CONTEXTUALLY_JUSTIFIED"
    ).length,
    uncertainCount: rows.filter((row) => row.verdict === "UNCERTAIN").length,
    unresolvedCount: rows.filter((row) => row.verdict == null).length,
    malformedCount: called.filter((row) => row.malformed).length,
    failureCount: rows.filter((row) => row.failure != null).length,
    humanLabelAgreementCount: agreement,
    clearHabitMissCount,
    justifiedFalseHighPriorityCount,
    inputTokens: called.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: called.reduce((sum, row) => sum + row.outputTokens, 0),
    actualProviderCostUsd:
      actualProviderCostCoverage === "complete" ? reportedProviderCostUsd : null,
    reportedProviderCostUsd,
    actualProviderCostReportedCalls: costs.length,
    actualProviderCostCoverage,
    latencyMs: summarizeLatency(called.map((row) => row.latencyMs)),
    model: JEV_DECISIONS_MODEL,
    provider: "openrouter-decisions",
    rows,
  };
}

function combineMetrics(
  fixtures: readonly AuthorialHabitJevFixture[],
  lexical: AuthorialHabitLexicalMetrics,
  jev: AuthorialHabitJevMetrics
): AuthorialHabitCombinedMetrics {
  const scanById = new Map(lexical.rows.map((row) => [row.fixtureId, row]));
  const jevById = new Map(jev.rows.map((row) => [row.fixtureId, row]));
  const disagreementFixtureIds: string[] = [];
  let trueHabitHighPriority = 0;
  let justifiedFalseHighPriority = 0;
  let clearHabitMissedByScanner = 0;
  let clearHabitMissedByJev = 0;

  for (const fixture of fixtures) {
    const scan = scanById.get(fixture.id)!;
    const judged = jevById.get(fixture.id);
    if (!scan.candidate) {
      if (fixture.expectedVerdict === "HABIT_PRESENT") {
        clearHabitMissedByScanner += 1;
        disagreementFixtureIds.push(fixture.id);
      }
      continue;
    }

    if (fixture.expectedVerdict === "HABIT_PRESENT") {
      if (judged?.verdict === "HABIT_PRESENT") trueHabitHighPriority += 1;
      else {
        clearHabitMissedByJev += 1;
        disagreementFixtureIds.push(fixture.id);
      }
    } else if (
      fixture.expectedVerdict === "CONTEXTUALLY_JUSTIFIED" &&
      judged?.verdict === "HABIT_PRESENT"
    ) {
      justifiedFalseHighPriority += 1;
      disagreementFixtureIds.push(fixture.id);
    } else if (judged?.verdict != null && judged.verdict !== fixture.expectedVerdict) {
      disagreementFixtureIds.push(fixture.id);
    } else if (judged?.malformed) {
      disagreementFixtureIds.push(fixture.id);
    }
  }

  const scannerOnlyReviewVolume = lexical.candidateCount;
  const jevHighPriorityReviewVolume = jev.habitPresentCount;
  const jevNeedsReviewVolume = jev.uncertainCount + jev.unresolvedCount;
  const jevTotalReviewVolume =
    jevHighPriorityReviewVolume + jevNeedsReviewVolume;
  const highPriorityReviewVolumeReductionVsScannerOnly =
    scannerOnlyReviewVolume > 0
      ? (scannerOnlyReviewVolume - jevHighPriorityReviewVolume) /
        scannerOnlyReviewVolume
      : null;
  const totalReviewVolumeReductionVsScannerOnly =
    scannerOnlyReviewVolume > 0
      ? (scannerOnlyReviewVolume - jevTotalReviewVolume) /
        scannerOnlyReviewVolume
      : null;

  return {
    scannerOnlyReviewVolume,
    jevHighPriorityReviewVolume,
    jevNeedsReviewVolume,
    jevTotalReviewVolume,
    highPriorityReviewVolumeReductionVsScannerOnly,
    totalReviewVolumeReductionVsScannerOnly,
    trueHabitHighPriority,
    justifiedFalseHighPriority,
    clearHabitMissedByScanner,
    clearHabitMissedByJev,
    disagreementFixtureIds: [...new Set(disagreementFixtureIds)],
  };
}

export async function runAuthorialHabitJevBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fixtures?: readonly AuthorialHabitJevFixture[];
  judgeFixture?: typeof judgeFixture;
} = {}): Promise<AuthorialHabitJevBenchmarkResult> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const fixtures = opts.fixtures ?? AUTHORIAL_HABIT_JEV_CORPUS;
  const benchmarkApiKey = resolveOptInJevAuthorialHabitBenchmarkApiKey(env);

  if (!benchmarkApiKey) {
    const missing: string[] = [];
    if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") {
      missing.push("REGULAR_TEST_REAL_PROVIDER_CALLS=1");
    }
    if (env[REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV] !== "1") {
      missing.push(`${REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV}=1`);
    }
    if (!env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim()) {
      missing.push(OPENROUTER_JEV_BENCHMARK_ENV);
    }
    const reason = `triple opt-in absent (${missing.join(", ") || "benchmark credentials"})`;
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const lexical = scanAuthorialHabitCorpus(fixtures);
  if (!opts.fixtures) {
    const balance = assertAuthorialHabitCandidateLabelBalance(fixtures);
    if (!balance.ok) {
      const reason = `candidate label balance gate failed: ${balance.detail}`;
      log(`NOT_RUN — ${reason}`);
      log("provider calls=0");
      return { status: "NOT_RUN", reason, providerCalls: 0 };
    }
  }

  const judge = opts.judgeFixture ?? judgeFixture;
  const rows: AuthorialHabitJevRow[] = [];
  for (const row of lexical.rows) {
    if (!row.candidate) continue;
    const fixture = fixtures.find((item) => item.id === row.fixtureId)!;
    rows.push(
      await judge({
        fixture,
        signals: row.signals,
        benchmarkApiKey,
      })
    );
  }

  const jev = aggregateJev(rows);
  const combined = combineMetrics(fixtures, lexical, jev);
  const result: AuthorialHabitJevBenchmarkResult = {
    status: "RAN",
    corpusSize: fixtures.length,
    lexical,
    jev,
    combined,
    totalProviderCalls: jev.providerCalls,
    productionMutationEnabled: false,
    runtimeHookEnabled: false,
  };
  log(JSON.stringify(result));
  return result;
}
