import assert from "node:assert/strict";
import { it } from "node:test";
import { runLabArm, runLabBaseline } from "@/lib/memoryResearch/benchmarkLab";
import { evaluateGates, type LabRunSummary } from "@/lib/memoryResearch/gates";
import { narrowSyntheticAdapter, wideSyntheticAdapter } from "@/lib/memoryResearch/labFixtures.test";
import type { BenchmarkMode } from "@/lib/memory/memory-rp-benchmark-suite";
import { SYNTHETIC_SEMANTIC_MODEL } from "@/lib/memory/memory-episodic-semantic-synthetic.test";

async function ran(mode: BenchmarkMode | null): Promise<LabRunSummary> {
  const result = mode ? await runLabArm(mode) : await runLabBaseline();
  assert.equal(result.status, "RAN", result.status === "FAILED" ? result.error : "");
  return (result as { summary: LabRunSummary }).summary;
}

it("baseline arm runs the canonical benchmark with zero network and zero embedding calls", async () => {
  const baseline = await ran(null);
  assert.equal(baseline.httpCallsObserved, 0);
  assert.deepEqual(baseline.embeddingCalls, { query: 0, index: 0 });
  assert.equal(baseline.metrics.cases, 35);
  assert.deepEqual(baseline.invariantViolations, []);
  assert.ok(baseline.evaluatedTurns > 0);
  assert.ok(baseline.promptTokensInjected > 0);
  assert.equal(baseline.finalHitByCase["item-ownership-01"], true);
  assert.equal(baseline.finalHitByCase["t300-01"], true);
});

it("network guard: an arm that attempts HTTP fails (WATCH path) and fetch is restored", async () => {
  const before = globalThis.fetch;
  const mode: BenchmarkMode = {
    label: "leaky",
    strict: false,
    semantic: {
      model: SYNTHETIC_SEMANTIC_MODEL,
      embed: async () => {
        await fetch("https://openrouter.ai/api/v1/embeddings");
        return [];
      },
    },
  };
  const result = await runLabArm(mode);
  assert.equal(result.status, "FAILED");
  assert.ok(result.status === "FAILED" && result.httpCallsAttempted > 0);
  assert.equal(globalThis.fetch, before);
});

it("real evidence: narrow synthetic semantic arm gains recall but regresses false memory → REJECTED", async () => {
  const baseline = await ran(null);
  const adapter = narrowSyntheticAdapter("github:fixture/narrow");
  const candidate = await ran({ ...adapter.buildMode(), strict: false });
  const gate = evaluateGates({ baseline, candidate, declared: adapter.declaredEfficiency, architectureDelta: adapter.architectureDelta });
  assert.ok(gate.flippedKnownGaps.includes("semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01"), "recall did improve");
  assert.equal(gate.decision, "REJECTED_FALSE_MEMORY_REGRESSION", gate.reason);
  assert.match(gate.reason, /falseMemoryRate regressed 0 → 0\.2/);
  assert.ok(candidate.embeddingCalls.query > 0, "embedding calls are counted");
  assert.equal(candidate.httpCallsObserved, 0);
});

it("real evidence: wide synthetic semantic arm gains recall without regressions → ACCEPTED", async () => {
  const baseline = await ran(null);
  const adapter = wideSyntheticAdapter("github:fixture/wide");
  const candidate = await ran({ ...adapter.buildMode(), strict: false });
  const gate = evaluateGates({ baseline, candidate, declared: adapter.declaredEfficiency, architectureDelta: adapter.architectureDelta });
  assert.equal(gate.decision, "ACCEPTED_QUALITY_GAIN", gate.reason);
  assert.deepEqual(gate.brokenPositiveCases, []);
  for (const c of gate.comparisons) assert.notEqual(c.verdict, "regressed", c.key);
  assert.ok(gate.efficiency.measured.embeddingCallsPerTurnDelta > 0);
});

it("efficiency gate: same quality gain rejected when declared cost/latency exceed budget", async () => {
  const baseline = await ran(null);
  const adapter = wideSyntheticAdapter("github:fixture/wide");
  const candidate = await ran({ ...adapter.buildMode(), strict: false });
  const costly = evaluateGates({
    baseline,
    candidate,
    declared: { ...adapter.declaredEfficiency, costUsdPer1kTurns: 3 },
    architectureDelta: adapter.architectureDelta,
  });
  assert.equal(costly.decision, "REJECTED_COST_REGRESSION");
  const slow = evaluateGates({
    baseline,
    candidate,
    declared: { ...adapter.declaredEfficiency, p95LatencyMsPerTurn: 900 },
    architectureDelta: adapter.architectureDelta,
  });
  assert.equal(slow.decision, "REJECTED_LATENCY_REGRESSION");
  const infra = evaluateGates({
    baseline,
    candidate,
    declared: adapter.declaredEfficiency,
    architectureDelta: { ...adapter.architectureDelta, newDb: ["pgvector"], newDependencies: ["neo4j-driver"] },
  });
  assert.equal(infra.decision, "REJECTED_INFRA_COMPLEXITY");
});

it("no quality gain: identical arm is REJECTED_NO_QUALITY_GAIN", async () => {
  const baseline = await ran(null);
  const same = await ran({ label: "baseline-copy", semantic: null, strict: false });
  const gate = evaluateGates({
    baseline,
    candidate: same,
    declared: wideSyntheticAdapter("x").declaredEfficiency,
    architectureDelta: wideSyntheticAdapter("x").architectureDelta,
  });
  assert.equal(gate.decision, "REJECTED_NO_QUALITY_GAIN");
});
