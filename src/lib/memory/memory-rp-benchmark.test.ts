import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import {
  computeBenchmarkMetrics,
  detectFalseInjection,
  formatBenchmarkMetricsLine,
} from "@/lib/memory/memory-rp-benchmark";
import {
  BASELINE_MODE,
  measureMilestoneRetention,
  openDb,
  runBenchmarkCases,
  seed,
  type BenchmarkMode,
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
    // Target: known gap flips (asserted inside the case); no metric regresses.
    assert.equal(run.knownGap.candidateHit, true);
    assert.equal(run.knownGap.finalHit, true);
    assert.equal(run.knownGap.semantic?.added, 1, "known-gap answer enters as a novel ID into unused capacity");
    assert.equal(retention.retained, baselineRetention.retained, "semantic never costs lexical milestone slots");
    assert.equal(run.metrics.falseInjectionRate.eligibleCases, baseline.metrics.falseInjectionRate.eligibleCases);
    assert.ok(run.metrics.falseInjectionRate.value! <= baseline.metrics.falseInjectionRate.value!);
    assert.ok(run.metrics.staleStateRecallRate.value! <= baseline.metrics.staleStateRecallRate.value!);
    assert.ok(run.metrics.candidateRecallAtK.value! >= baseline.metrics.candidateRecallAtK.value!);
    assert.ok(run.metrics.finalRecallAt8.value! >= baseline.metrics.finalRecallAt8.value!);
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
