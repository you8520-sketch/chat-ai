import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import {
  computeBenchmarkMetrics,
  computeScaleMatrixFirstDegradation,
  detectFalseInjection,
  formatBenchmarkMetricsLine,
  formatScaleMatrixLine,
  LONG_HORIZON_SCALES,
  scaleMatrixMeasured,
  scaleMatrixNotApplicable,
  type LongHorizonScaleRow,
} from "@/lib/memory/memory-rp-benchmark";
import {
  BASELINE_MODE,
  EXPANDED_BASELINE_CASE_IDS,
  EXPANDED_BASELINE_KNOWN_GAPS,
  measureLongHorizonScaleMatrix,
  measureMilestoneRetention,
  openDb,
  runBenchmarkCases,
  seed,
  type BenchmarkMode,
  type BenchmarkRun,
  type BenchmarkTransportProbe,
} from "@/lib/memory/memory-rp-benchmark-suite";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";
import {
  countingSyntheticEmbedder,
  SYNTHETIC_SEMANTIC_MODEL,
} from "@/lib/memory/memory-episodic-semantic-synthetic.test";

let httpCallsObserved = 0;
let jevCallsObserved = 0;
let savedFetch: typeof fetch | undefined;

const transportProbe: BenchmarkTransportProbe = {
  snapshot: () => ({ httpCallsObserved, jevCallsObserved }),
};

beforeEach(() => {
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    httpCallsObserved += 1;
    if (String(url).startsWith(JEV_DECISIONS_URL)) jevCallsObserved += 1;
    throw new Error("benchmark must not perform provider HTTP");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch!;
});

function original1072Metrics(run: BenchmarkRun) {
  const expanded = new Set(EXPANDED_BASELINE_CASE_IDS);
  return computeBenchmarkMetrics(
    run.outcomes.filter((o) => !expanded.has(o.caseId)),
    run.coverage
  );
}

it("RP memory benchmark executes all requested categories against real canonical owners", async () => {
  const { outcomes, metrics } = await runBenchmarkCases(BASELINE_MODE, transportProbe);

  // Eligibility is derived from evidence actually produced, never fixed.
  const expectFalseInjectionEligible = outcomes.filter((o) => o.final).length;
  assert.equal(metrics.cases, outcomes.length);
  assert.equal(metrics.falseInjectionRate.eligibleCases, expectFalseInjectionEligible);
  assert.ok(expectFalseInjectionEligible < outcomes.length, "non-retrieval cases must not inflate the denominator");
  assert.equal(metrics.falseInjectionRate.totalCases, outcomes.length);
  assert.equal(metrics.staleStateRecallRate.eligibleCases, outcomes.filter((o) => o.stale).length);

  for (const m of [metrics.candidateRecallAtK, metrics.finalRecallAt8, metrics.falseInjectionRate, metrics.staleStateRecallRate]) {
    assert.equal(m.status, "MEASURED");
  }
  assert.equal(metrics.falseInjectionRate.value, 0);
  assert.equal(metrics.staleStateRecallRate.value, 0);
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.status, "MEASURED");
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.eligibleCases, 1);
  assert.equal(metrics.wrongObserverKnowledgeLeakCount.value, 0);
  assert.equal(metrics.secretLeakCount.status, "NOT_MEASURED");
  assert.equal(metrics.secretLeakCount.value, null);
  assert.equal(metrics.providerCallsPerTurn.status, "MEASURED");
  assert.equal(metrics.providerCallsPerTurn.value, 0);
  assert.equal(metrics.jevInvocationRate.status, "MEASURED");
  assert.equal(metrics.jevInvocationRate.value, 0);
  assert.equal(httpCallsObserved, 0);
  for (const m of [metrics.baselineVsShadowDelta, metrics.jevP50LatencyMs, metrics.jevP95LatencyMs, metrics.jevCostPer1000Turns, metrics.promptTokenDelta, metrics.fallbackParity]) {
    assert.equal(m.status, "NOT_APPLICABLE");
    assert.equal(m.value, null);
  }
});

it("expanded baseline: horizons + behavior categories measured on current main with pinned known gaps", async () => {
  const { outcomes, metrics } = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const byId = new Map(outcomes.map((o) => [o.caseId, o]));
  for (const caseId of EXPANDED_BASELINE_CASE_IDS) {
    const o = byId.get(caseId);
    assert.ok(o, `${caseId} must execute`);
    if (!o.final || o.final.expectedAnswerIds.length === 0) continue;
    const finalHit = o.final.expectedAnswerIds.every((id) => o.final!.injectedFactIds.includes(id));
    const candidateHit = o.candidate
      ? o.candidate.expectedAnswerIds.every((id) => o.candidate!.candidateIds.includes(id))
      : finalHit;
    const gap = EXPANDED_BASELINE_KNOWN_GAPS[caseId];
    assert.equal(finalHit, gap === undefined, `${caseId} final outcome vs pinned baseline`);
    assert.equal(candidateHit, gap !== "candidate", `${caseId} candidate outcome vs pinned baseline`);
  }
  assert.equal(metrics.precision.status, "MEASURED");
  assert.equal(metrics.precision.value, 1);
  assert.equal(metrics.falseMemoryRate.status, "MEASURED");
  assert.equal(metrics.falseMemoryRate.value, 0);
  assert.equal(metrics.irrelevantInjectionRate.value, 0);
  assert.equal(metrics.relationshipRoleConsistency.value, 1);
  assert.equal(metrics.distinctiveUtteranceRecall.value, 0, "known gap: distinctive-utterance-01");
  assert.equal(metrics.correctionSupersessionAccuracy.value, 1);
  const falseMemory = byId.get("false-memory-negative-01")!;
  assert.deepEqual(falseMemory.final?.injectedFactIds, []);
  const ownership = byId.get("item-ownership-01")!;
  assert.deepEqual(ownership.final?.injectedFactIds, [], "ledger-owned owner facts must not inject");
  assert.equal(
    ownership.candidate?.expectedAnswerIds.every((id) => ownership.candidate!.candidateIds.includes(id)),
    true,
    "TEST_SUBSTITUTE seed may still appear in candidates"
  );
  const highNoise = byId.get("high-noise-distractors-01")!;
  assert.equal(
    highNoise.final?.expectedAnswerIds.every((id) => highNoise.final!.injectedFactIds.includes(id)),
    true,
    "high-noise target must inject after relevance-key reconcile priority"
  );
  for (const caseId of ["item-ownership-01", "distinctive-utterance-01", "high-noise-distractors-01", "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01"]) {
    const o = byId.get(caseId);
    assert.ok(o, `${caseId} must exist for stage dump`);
    const candHit = o.candidate
      ? o.candidate.expectedAnswerIds.every((id) => o.candidate!.candidateIds.includes(id))
      : null;
    const finHit = o.final
      ? o.final.expectedAnswerIds.every((id) => o.final!.injectedFactIds.includes(id))
      : null;
    console.info(
      `[RpMemoryBenchmark] knownGapStage ${caseId} persisted=TEST_SUBSTITUTE candidateEntered=${candHit} candidateCount=${o.candidate?.candidateIds.length ?? "n/a"} finalSelected=${finHit} injected=${o.final?.injectedFactIds.length ?? "n/a"} staleInjected=${
        o.stale ? o.stale.injectedFactIds.some((id) => o.stale!.staleFactIds.includes(id)) : "n/a"
      }`
    );
  }
});

/**
 * Milestone retention under semantic budget pressure: many old critical
 * historical milestones compete with semantically matching facts and a
 * saturated recent lane. Reports how many milestones stay in the candidate set.
 */
it("semantic shadow (synthetic embedder): same cases, same metric semantics, budget-share variants", async () => {
  const baseline = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const baselineRetention = await measureMilestoneRetention(BASELINE_MODE);
  console.info(
    `[RpMemoryBenchmark] mode=${BASELINE_MODE.label} knownGap=${JSON.stringify(baseline.knownGap)} milestoneRetention=${baselineRetention.retained}/${baselineRetention.total} milestoneCaseSemantic=${JSON.stringify(baselineRetention.semantic)}`
  );
  const shares = [0.05, SYNTHETIC_SEMANTIC_MODEL.semanticLaneMaxShare, 0.2];
  for (const share of shares) {
    const mode: BenchmarkMode = {
      label: `synthetic-semantic-share-${share}`,
      semantic: { model: { ...SYNTHETIC_SEMANTIC_MODEL, semanticLaneMaxShare: share }, embed: countingSyntheticEmbedder().embed },
      strict: true,
      expectKnownGapHit: true,
    };
    const run = await runBenchmarkCases(mode, transportProbe);
    const retention = await measureMilestoneRetention(mode);
    console.info(
      `[RpMemoryBenchmark] mode=${mode.label} knownGap=${JSON.stringify(run.knownGap)} milestoneRetention=${retention.retained}/${retention.total} milestoneCaseSemantic=${JSON.stringify(retention.semantic)}`
    );
    // Target: known gap flips (asserted inside the case); no #1072 metric regresses.
    // The #1072 no-regression claim is scoped to its own case set; the
    // expanded-baseline cases are the research lab's surface and are judged
    // by its gates (see memoryResearch/benchmarkLab.test.ts).
    assert.equal(run.knownGap.candidateHit, true);
    assert.equal(run.knownGap.finalHit, true);
    assert.equal(run.knownGap.semantic?.added, 1, "known-gap answer enters as a novel ID into unused capacity");
    assert.equal(retention.retained, baselineRetention.retained, "semantic never costs lexical milestone slots");
    const baseline1072 = original1072Metrics(baseline);
    const run1072 = original1072Metrics(run);
    assert.equal(run1072.falseInjectionRate.eligibleCases, baseline1072.falseInjectionRate.eligibleCases);
    assert.ok(run1072.falseInjectionRate.value! <= baseline1072.falseInjectionRate.value!);
    assert.ok(run1072.staleStateRecallRate.value! <= baseline1072.staleStateRecallRate.value!);
    assert.ok(run1072.candidateRecallAtK.value! >= baseline1072.candidateRecallAtK.value!);
    assert.ok(run1072.finalRecallAt8.value! >= baseline1072.finalRecallAt8.value!);
    assert.equal(run.metrics.wrongObserverKnowledgeLeakCount.value, 0);
    assert.deepEqual(run.invariantViolations, []);
    assert.equal(run.metrics.providerCallsPerTurn.value, 0, "synthetic embedder; real provider HTTP = 0");
    const zeroRelevant = run.outcomes.find((o) => o.category === "zero_relevant_control")!;
    assert.deepEqual(zeroRelevant.final?.injectedFactIds, []);
  }
});

it("false-injection metric detects an injected fact outside the allowed set (negative proof)", () => {
  // Real fixture ids (relevant normal answer + unrelated critical fact), but a
  // deliberately wrong final result is fed to the pure metric evaluator — the
  // production scorer is not manipulated.
  const db = openDb();
  const [unrelatedCriticalId] = seed(db, [[10, "setting", "tower", "color", "blue", "critical", "북쪽 탑은 파란색이었다."]]);
  const [answerId] = seed(db, [[11, "setting", "storm", "shelter", "cave", "normal", "폭풍우가 올 때 동굴에 피신했다."]]);
  db.close();

  const wrong = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [answerId!, unrelatedCriticalId!] };
  const onlyWrong = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [unrelatedCriticalId!] };
  const clean = { expectedAnswerIds: [answerId!], allowedFactIds: [answerId!], injectedFactIds: [answerId!] };
  const emptyAllowedButInjected = { expectedAnswerIds: [], allowedFactIds: [], injectedFactIds: [unrelatedCriticalId!] };
  assert.equal(detectFalseInjection(wrong), true);
  assert.equal(detectFalseInjection(onlyWrong), true);
  assert.equal(detectFalseInjection(emptyAllowedButInjected), true);
  assert.equal(detectFalseInjection(clean), false);

  const metrics = computeBenchmarkMetrics(
    [
      { caseId: "neg-wrong", category: "irrelevant_critical_vs_relevant_normal", final: wrong },
      { caseId: "neg-clean", category: "irrelevant_critical_vs_relevant_normal", final: clean },
      { caseId: "neg-no-final", category: "user_canonical_vs_assistant_hallucination" },
    ],
    []
  );
  assert.equal(metrics.falseInjectionRate.status, "MEASURED");
  assert.equal(metrics.falseInjectionRate.eligibleCases, 2);
  assert.equal(metrics.falseInjectionRate.totalCases, 3);
  assert.equal(metrics.falseInjectionRate.value, 0.5);
  assert.equal(metrics.finalRecallAt8.value, 1);
  console.info(`[RpMemoryBenchmark] negative proof: ${formatBenchmarkMetricsLine(metrics)}`);
});

it("long-horizon store-size matrix measures 5/20/100/300/1000/2000 on production retrieval", async () => {
  const matrix = await measureLongHorizonScaleMatrix(BASELINE_MODE);
  assert.deepEqual(
    matrix.rows.map((row) => row.scale),
    [...LONG_HORIZON_SCALES]
  );
  assert.equal(matrix.persistPath, "TEST_SUBSTITUTE");
  assert.equal(matrix.retrievalPath, "PRODUCTION");
  assert.equal(matrix.captureExtractPath, "NOT_EXECUTED");
  assert.equal(matrix.contextAssemblyPath, "NOT_EXECUTED");
  assert.equal(httpCallsObserved, 0);

  for (const row of matrix.rows) {
    assert.equal(row.persistedFactCount.value, row.scale);
    assert.equal(row.persistedFactCount.status, "MEASURED");
    assert.equal(row.candidateCount.status, "MEASURED");
    assert.equal(row.candidateRecallAtK.status, "MEASURED");
    assert.equal(row.finalRecallAtK.status, "MEASURED");
    assert.equal(row.falseInjectionRate.status, "MEASURED");
    assert.equal(row.identityContinuityRecall.status, "MEASURED");
    assert.equal(row.promptTokenCount.status, "MEASURED");
    assert.equal(row.latencyMs.status, "MEASURED");
    assert.equal(row.staleStateInjectionRate.status, "NOT_APPLICABLE");
    assert.equal(row.staleStateInjectionRate.value, null);
    assert.equal(row.mutationIsolation.status, "NOT_APPLICABLE");
    assert.equal(row.observerIsolation.status, "NOT_APPLICABLE");
    assert.ok(
      row.candidateCount.value != null && row.candidateCount.value <= 100,
      "production candidateLimit default is 100"
    );
    assert.equal(row.candidateRecallAtK.value, 1, `lexical identity target must stay in candidates at scale ${row.scale}`);
    assert.equal(row.finalRecallAtK.value, 1, `lexical identity target must stay in final set at scale ${row.scale}`);
    assert.equal(row.identityContinuityRecall.value, 1);
    assert.equal(row.falseInjectionRate.value, 0);
  }
  assert.equal(matrix.firstDegradation.candidateRecall, null);
  assert.equal(matrix.firstDegradation.finalRecall, null);
  assert.equal(matrix.firstDegradation.packingSaturation, null);

  console.info(`[RpMemoryBenchmark] ${formatScaleMatrixLine(matrix)}`);
});

it("scale-matrix first-degradation helper records the first measured drop only", () => {
  const na = scaleMatrixNotApplicable("n/a");
  const stub = (scale: (typeof LONG_HORIZON_SCALES)[number], cand: number, fin: number, sat: number, ms: number): LongHorizonScaleRow => ({
    scale,
    persistedFactCount: scaleMatrixMeasured(scale),
    candidateCount: scaleMatrixMeasured(8),
    candidateRecallAtK: scaleMatrixMeasured(cand),
    finalRecallAtK: scaleMatrixMeasured(fin),
    falseInjectionRate: scaleMatrixMeasured(0),
    staleStateInjectionRate: na,
    latestStateRecall: na,
    historicalEventRecall: na,
    relationshipContinuityRecall: na,
    identityContinuityRecall: scaleMatrixMeasured(fin),
    zeroRelevantPrecision: na,
    mutationIsolation: na,
    observerIsolation: na,
    promptTokenCount: scaleMatrixMeasured(40),
    injectedMemoryTokenCount: scaleMatrixMeasured(40),
    packingSaturation: scaleMatrixMeasured(sat),
    latencyMs: scaleMatrixMeasured(ms),
    dbRowCount: scaleMatrixMeasured(scale),
  });
  const degradation = computeScaleMatrixFirstDegradation([
    stub(5, 1, 1, 0.2, 4),
    stub(20, 1, 1, 0.4, 5),
    stub(100, 1, 0, 1.0, 6),
    stub(300, 0, 0, 1.1, 20),
  ]);
  assert.equal(degradation.candidateRecall, 300);
  assert.equal(degradation.finalRecall, 100);
  assert.equal(degradation.packingSaturation, 100);
  assert.equal(degradation.latencyJump, 300);
});

it("unexecuted stages stay NOT_MEASURED instead of counting as 0", () => {
  const metrics = computeBenchmarkMetrics(
    [{ caseId: "guard-only", category: "user_canonical_vs_assistant_hallucination" }],
    []
  );
  for (const m of [metrics.candidateRecallAtK, metrics.finalRecallAt8, metrics.falseInjectionRate, metrics.staleStateRecallRate, metrics.wrongObserverKnowledgeLeakCount, metrics.secretLeakCount]) {
    assert.equal(m.status, "NOT_MEASURED");
    assert.equal(m.value, null);
    assert.equal(m.eligibleCases, 0);
  }
});
