import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";

import { allocateEpisodicDynamicCharBudget } from "@/lib/episodicMemoryFacts";
import { BENCHMARK_CAPABILITY_CASE_IDS } from "@/lib/memory/memory-rp-benchmark";
import {
  BASELINE_MODE,
  runBenchmarkCases,
  type BenchmarkMode,
  type BenchmarkTransportProbe,
} from "@/lib/memory/memory-rp-benchmark-suite";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";

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

function packingMode(label: string, packing: NonNullable<BenchmarkMode["packing"]>): BenchmarkMode {
  return { ...BASELINE_MODE, label, packing, strict: false };
}

function selectionMode(label: string, selection: NonNullable<BenchmarkMode["selection"]>): BenchmarkMode {
  return { ...BASELINE_MODE, label, selection, strict: false };
}

it("omitted packing/selection arms match the lexical baseline", async () => {
  const baseline = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const explicitEmpty = await runBenchmarkCases(
    { ...BASELINE_MODE, label: "explicit-empty-hooks", packing: {}, selection: {} },
    transportProbe
  );
  assert.equal(baseline.metrics.falseInjectionRate.value, explicitEmpty.metrics.falseInjectionRate.value);
  assert.equal(baseline.metrics.staleStateRecallRate.value, explicitEmpty.metrics.staleStateRecallRate.value);
  assert.equal(baseline.metrics.finalRecallAt8.value, explicitEmpty.metrics.finalRecallAt8.value);
  assert.equal(baseline.metrics.candidateRecallAtK.value, explicitEmpty.metrics.candidateRecallAtK.value);
  assert.equal(baseline.injectedFactCount, explicitEmpty.injectedFactCount);
  assert.equal(baseline.retrievedFactCount, explicitEmpty.retrievedFactCount);
  assert.equal(baseline.promptTokensInjected, explicitEmpty.promptTokensInjected);
  assert.equal(httpCallsObserved, 0);
});

it("prompt_packing leftover policy is A/Bable through BenchmarkMode.packing", () => {
  const starved = allocateEpisodicDynamicCharBudget({
    maxChars: 1000,
    dynamicMemoryTotalMaxChars: 2500,
    higherPriorityDynamicChars: 2500,
    hasRelevancePassCandidates: true,
    policy: "baseline",
  });
  const reserved = allocateEpisodicDynamicCharBudget({
    maxChars: 1000,
    dynamicMemoryTotalMaxChars: 2500,
    higherPriorityDynamicChars: 2500,
    hasRelevancePassCandidates: true,
    policy: "reserved_floor",
  });
  assert.equal(starved.effectiveMaxChars, 0);
  assert.ok(reserved.effectiveMaxChars > 0);
  const mode = packingMode("packing-reserved-floor", {
    dynamicBudgetPolicy: "reserved_floor",
    longTermMemoryText: "x".repeat(2500),
  });
  assert.equal(mode.packing?.dynamicBudgetPolicy, "reserved_floor");
  assert.equal(mode.packing?.longTermMemoryText?.length, 2500);
});

it("episodic_selection bounds change injected count without a parallel scorer", async () => {
  const baseline = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const capped = await runBenchmarkCases(selectionMode("selection-max-facts-1", { maxFacts: 1 }), transportProbe);
  assert.ok(baseline.injectedFactCount > 0);
  assert.ok(capped.injectedFactCount > 0);
  assert.ok(
    capped.injectedFactCount < baseline.injectedFactCount,
    "a tighter fact cap must inject fewer facts on the same cases"
  );
  assert.equal(capped.metrics.falseMemoryRate.value, 0);
  assert.equal(capped.metrics.staleStateRecallRate.value, 0);
  assert.equal(httpCallsObserved, 0);
});

it("packing arm can model supplied Global-text pressure without claiming a Global compaction hook", async () => {
  const baseline = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const globalFilled = await runBenchmarkCases(
    packingMode("global-layer-filled", { longTermMemoryText: "x".repeat(2500), dynamicBudgetPolicy: "baseline" }),
    transportProbe
  );
  assert.ok(baseline.injectedFactCount > globalFilled.injectedFactCount);
  assert.equal(globalFilled.metrics.providerCallsPerTurn.value, 0);
  assert.equal(httpCallsObserved, 0);
});

it("capability groups only regroup existing case ids", async () => {
  const run = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const ids = new Set(run.outcomes.map((outcome) => outcome.caseId));
  for (const evidence of run.capabilityEvidence) {
    assert.deepEqual(evidence.caseIds, BENCHMARK_CAPABILITY_CASE_IDS[evidence.group]);
    assert.equal(evidence.measuredCases, evidence.caseIds.length);
    for (const caseId of evidence.caseIds) {
      assert.ok(ids.has(caseId), `${evidence.group} missing ${caseId}`);
    }
  }
  const temporal = run.capabilityEvidence.find((row) => row.group === "TEMPORAL_REASONING");
  assert.ok(temporal);
  assert.ok((temporal.finalHits ?? 0) >= 4);
});
