/**
 * Two-stage Main RP completion-integrity shadow benchmark:
 *   deterministic candidate → bounded JEV semantic verdict.
 *
 * Read-only QA metrics only. No Main RP calls, no billing/recovery mutation.
 */
import {
  callJevDecisions,
  JEV_DECISIONS_MODEL,
} from "@/lib/jevDecisions";
import {
  COMPLETION_INTEGRITY_CORPUS,
  type CompletionIntegrityFixture,
  type CompletionIntegrityVerdict,
} from "@/lib/completionIntegrityCorpus";
import {
  evaluateFixtureCompletionCandidate,
  type CompletionCandidateReason,
} from "@/lib/completionIntegrityCandidate";
import {
  assertCompletionIntegrityJevStateHasNoPrivateIdentifiers,
  buildCompletionIntegrityJevQuestions,
  buildCompletionIntegrityJevState,
  parseCompletionIntegrityJevVerdict,
} from "@/lib/completionIntegrityJevJudge";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV,
  resolveOptInJevCompletionIntegrityBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";

export type CompletionFixtureScanRow = {
  fixtureId: string;
  expectedVerdict: CompletionIntegrityVerdict;
  expectDeterministicCandidate: boolean;
  candidate: boolean;
  reasons: CompletionCandidateReason[];
};

export type CompletionFixtureJevRow = {
  fixtureId: string;
  expectedVerdict: CompletionIntegrityVerdict;
  reasons: CompletionCandidateReason[];
  verdict: CompletionIntegrityVerdict | null;
  malformed: boolean;
  failure: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
  model: string;
  providerCallAttempted: boolean;
};

export type CompletionLexicalMetrics = {
  totalFixtures: number;
  candidateCount: number;
  abruptCandidateRecall: number | null;
  abruptScannerMissCount: number;
  completeCandidateCount: number;
  uncertainCandidateCount: number;
  candidateReasonDistribution: Record<string, number>;
  rows: CompletionFixtureScanRow[];
};

export type CompletionJevMetrics = {
  calledFixtures: number;
  providerCalls: number;
  /** Physical HTTP attempts (JEV transport has no retry loop). */
  physicalAttempts: number;
  /** Always 0 — callJevDecisions does not retry. */
  retries: number;
  abruptCutCount: number;
  completeCount: number;
  uncertainCount: number;
  malformedCount: number;
  failureCount: number;
  humanLabelAgreementCount: number;
  falseAbruptCutCount: number;
  missedAbruptCutAmongCalled: number;
  inputTokens: number;
  outputTokens: number;
  actualProviderCostUsd: number | null;
  latencyMs: { p50: number | null; p95: number | null; max: number | null; count: number };
  model: string;
  provider: string;
  rows: CompletionFixtureJevRow[];
};

export type CompletionCombinedMetrics = {
  trueAbruptAlerts: number;
  completeFalseAlerts: number;
  abruptCutsMissedByScanner: number;
  abruptCutsMissedByJev: number;
  uncertainOutcomes: number;
  scannerOnlyHighPriority: number;
  jevAbruptHighPriority: number;
  reviewVolumeReductionVsScannerOnly: number | null;
  disagreementFixtureIds: string[];
};

export type CompletionIntegrityBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | {
      status: "RAN";
      corpusSize: number;
      lexical: CompletionLexicalMetrics;
      jev: CompletionJevMetrics;
      combined: CompletionCombinedMetrics;
      totalProviderCalls: number;
      productionMutationEnabled: false;
    };

function summarizeLatency(values: number[]): CompletionJevMetrics["latencyMs"] {
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

export function scanCompletionCorpus(
  fixtures: readonly CompletionIntegrityFixture[] = COMPLETION_INTEGRITY_CORPUS
): CompletionLexicalMetrics {
  const reasonDist: Record<string, number> = {};
  const rows: CompletionFixtureScanRow[] = [];
  let candidateCount = 0;
  let abruptTrue = 0;
  let abruptHit = 0;
  let abruptMiss = 0;
  let completeCandidateCount = 0;
  let uncertainCandidateCount = 0;

  for (const fixture of fixtures) {
    const evaled = evaluateFixtureCompletionCandidate(fixture);
    if (evaled.candidate) {
      candidateCount += 1;
      for (const r of evaled.reasons) reasonDist[r] = (reasonDist[r] ?? 0) + 1;
      if (fixture.expectedVerdict === "COMPLETE") completeCandidateCount += 1;
      if (fixture.expectedVerdict === "UNCERTAIN") uncertainCandidateCount += 1;
    }
    if (fixture.expectedVerdict === "ABRUPT_CUT") {
      abruptTrue += 1;
      if (evaled.candidate) abruptHit += 1;
      else abruptMiss += 1;
    }
    rows.push({
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      expectDeterministicCandidate: fixture.expectDeterministicCandidate,
      candidate: evaled.candidate,
      reasons: evaled.reasons,
    });
  }

  return {
    totalFixtures: fixtures.length,
    candidateCount,
    abruptCandidateRecall: abruptTrue > 0 ? abruptHit / abruptTrue : null,
    abruptScannerMissCount: abruptMiss,
    completeCandidateCount,
    uncertainCandidateCount,
    candidateReasonDistribution: reasonDist,
    rows,
  };
}

/** Balance gate: among candidates, require meaningful class coverage. */
export function assertCompletionCandidateLabelBalance(
  fixtures: readonly CompletionIntegrityFixture[] = COMPLETION_INTEGRITY_CORPUS
): {
  ok: boolean;
  abrupt: number;
  complete: number;
  uncertain: number;
  candidateCount: number;
  detail: string;
} {
  const lexical = scanCompletionCorpus(fixtures);
  let abrupt = 0;
  let complete = 0;
  let uncertain = 0;
  for (const row of lexical.rows) {
    if (!row.candidate) continue;
    if (row.expectedVerdict === "ABRUPT_CUT") abrupt += 1;
    else if (row.expectedVerdict === "COMPLETE") complete += 1;
    else uncertain += 1;
  }
  const ok = abrupt >= 8 && complete >= 6 && uncertain >= 3;
  return {
    ok,
    abrupt,
    complete,
    uncertain,
    candidateCount: lexical.candidateCount,
    detail: `candidate-positive labels ABRUPT=${abrupt} COMPLETE=${complete} UNCERTAIN=${uncertain} (need >=8/6/3)`,
  };
}

async function judgeFixture(opts: {
  fixture: CompletionIntegrityFixture;
  reasons: CompletionCandidateReason[];
  apiKey: string;
}): Promise<CompletionFixtureJevRow> {
  const { fixture, reasons, apiKey } = opts;
  const state = buildCompletionIntegrityJevState({ fixture, candidateReasons: reasons });
  const leak = assertCompletionIntegrityJevStateHasNoPrivateIdentifiers(
    state as unknown as Record<string, unknown>
  );
  const started = performance.now();
  try {
    if (leak.length) throw new Error(`jev_state_invariant_violation:${leak.join(",")}`);
    const result = await callJevDecisions({
      state,
      questions: buildCompletionIntegrityJevQuestions(),
      apiKey,
      ledger: null,
      timeoutMs: 60_000,
    });
    const verdict = parseCompletionIntegrityJevVerdict(
      result.answers as Record<string, { type?: string; choice?: string }>
    );
    const malformed = verdict == null;
    return {
      fixtureId: fixture.id,
      expectedVerdict: fixture.expectedVerdict,
      reasons,
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
      reasons,
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

function aggregateJev(rows: CompletionFixtureJevRow[]): CompletionJevMetrics {
  const called = rows.filter((r) => r.providerCallAttempted);
  const costs = called.map((r) => r.actualCostUsd).filter((c): c is number => c != null);
  let agreement = 0;
  let falseAbrupt = 0;
  let missedAbrupt = 0;
  for (const row of called) {
    if (row.verdict == null) continue;
    if (row.verdict === row.expectedVerdict) agreement += 1;
    if (row.verdict === "ABRUPT_CUT" && row.expectedVerdict !== "ABRUPT_CUT") falseAbrupt += 1;
    if (row.expectedVerdict === "ABRUPT_CUT" && row.verdict !== "ABRUPT_CUT") missedAbrupt += 1;
  }
  return {
    calledFixtures: called.length,
    providerCalls: called.length,
    physicalAttempts: called.length,
    retries: 0,
    abruptCutCount: called.filter((r) => r.verdict === "ABRUPT_CUT").length,
    completeCount: called.filter((r) => r.verdict === "COMPLETE").length,
    uncertainCount: called.filter((r) => r.verdict === "UNCERTAIN").length,
    malformedCount: called.filter((r) => r.malformed).length,
    failureCount: called.filter((r) => r.failure != null).length,
    humanLabelAgreementCount: agreement,
    falseAbruptCutCount: falseAbrupt,
    missedAbruptCutAmongCalled: missedAbrupt,
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
  fixtures: readonly CompletionIntegrityFixture[],
  lexical: CompletionLexicalMetrics,
  jev: CompletionJevMetrics
): CompletionCombinedMetrics {
  const scanById = new Map(lexical.rows.map((r) => [r.fixtureId, r]));
  const jevById = new Map(jev.rows.map((r) => [r.fixtureId, r]));
  let trueAbruptAlerts = 0;
  let completeFalseAlerts = 0;
  let abruptCutsMissedByScanner = 0;
  let abruptCutsMissedByJev = 0;
  let uncertainOutcomes = 0;
  const disagreementFixtureIds: string[] = [];

  for (const fixture of fixtures) {
    const scan = scanById.get(fixture.id)!;
    const judged = jevById.get(fixture.id);
    const alert = Boolean(scan.candidate && judged?.verdict === "ABRUPT_CUT");

    if (fixture.expectedVerdict === "UNCERTAIN") uncertainOutcomes += 1;

    if (fixture.expectedVerdict === "ABRUPT_CUT") {
      if (!scan.candidate) {
        abruptCutsMissedByScanner += 1;
        disagreementFixtureIds.push(fixture.id);
      } else if (judged?.verdict !== "ABRUPT_CUT") {
        abruptCutsMissedByJev += 1;
        disagreementFixtureIds.push(fixture.id);
      } else if (alert) {
        trueAbruptAlerts += 1;
      }
    } else if (fixture.expectedVerdict === "COMPLETE" && alert) {
      completeFalseAlerts += 1;
      disagreementFixtureIds.push(fixture.id);
    } else if (judged && judged.verdict != null && judged.verdict !== fixture.expectedVerdict) {
      disagreementFixtureIds.push(fixture.id);
    } else if (judged?.malformed) {
      disagreementFixtureIds.push(fixture.id);
    }
  }

  const scannerOnlyHighPriority = lexical.candidateCount;
  const jevAbruptHighPriority = jev.abruptCutCount;
  const reduction =
    scannerOnlyHighPriority > 0
      ? (scannerOnlyHighPriority - jevAbruptHighPriority) / scannerOnlyHighPriority
      : null;

  return {
    trueAbruptAlerts,
    completeFalseAlerts,
    abruptCutsMissedByScanner,
    abruptCutsMissedByJev,
    uncertainOutcomes,
    scannerOnlyHighPriority,
    jevAbruptHighPriority,
    reviewVolumeReductionVsScannerOnly: reduction,
    disagreementFixtureIds: [...new Set(disagreementFixtureIds)],
  };
}

export async function runCompletionIntegrityJevBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  fixtures?: readonly CompletionIntegrityFixture[];
  judgeFixture?: typeof judgeFixture;
} = {}): Promise<CompletionIntegrityBenchmarkResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? process.env;
  const apiKey = resolveOptInJevCompletionIntegrityBenchmarkApiKey(env);
  const fixtures = opts.fixtures ?? COMPLETION_INTEGRITY_CORPUS;

  if (!apiKey) {
    const missing: string[] = [];
    if (env.REGULAR_TEST_REAL_PROVIDER_CALLS !== "1") missing.push("REGULAR_TEST_REAL_PROVIDER_CALLS=1");
    if (env[REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV] !== "1") {
      missing.push(`${REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV}=1`);
    }
    if (!env[OPENROUTER_JEV_BENCHMARK_ENV]?.trim()) missing.push(OPENROUTER_JEV_BENCHMARK_ENV);
    const reason = `triple opt-in absent (${missing.join(", ") || "benchmark credentials"})`;
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const lexical = scanCompletionCorpus(fixtures);

  // Balance gate only for the full default corpus (live path). Subset fixture
  // overrides used by isolation tests must still be able to prove HTTP 0.
  if (!opts.fixtures) {
    const balance = assertCompletionCandidateLabelBalance(fixtures);
    if (!balance.ok) {
      const reason = `candidate label balance gate failed: ${balance.detail}`;
      log(`NOT_RUN — ${reason}`);
      log("provider calls=0");
      return { status: "NOT_RUN", reason, providerCalls: 0 };
    }
  }

  const judge = opts.judgeFixture ?? judgeFixture;
  const jevRows: CompletionFixtureJevRow[] = [];

  for (const row of lexical.rows) {
    if (!row.candidate) continue;
    const fixture = fixtures.find((f) => f.id === row.fixtureId)!;
    jevRows.push(await judge({ fixture, reasons: row.reasons, apiKey }));
  }

  const jev = aggregateJev(jevRows);
  const combined = combineMetrics(fixtures, lexical, jev);
  const result: CompletionIntegrityBenchmarkResult = {
    status: "RAN",
    corpusSize: fixtures.length,
    lexical,
    jev,
    combined,
    totalProviderCalls: jev.providerCalls,
    productionMutationEnabled: false,
  };
  log(JSON.stringify(result));
  return result;
}
