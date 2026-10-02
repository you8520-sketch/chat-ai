import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import Database from "better-sqlite3";

import {
  allocateEpisodicDynamicCharBudget,
  ensureEpisodicMemoryFactsTable,
  getEpisodicMemoryForPrompt,
  resolveEpisodicRerankingPolicy,
} from "@/lib/episodicMemoryFacts";
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

function scoringMode(label: string, scoring: NonNullable<BenchmarkMode["scoring"]>): BenchmarkMode {
  return { ...BASELINE_MODE, label, scoring, strict: false };
}

const recallEnv = {
  MEMORY_FEATURE_ENABLED: "1",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
} as unknown as NodeJS.ProcessEnv;

function createScoringDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  const insert = db.prepare(
    `INSERT INTO episodic_memory_facts
      (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES
      (1, ?, 'setting', ?, ?, ?, ?, ?, '{"memory_evidence_type":"explicit_scene_event"}')`
  );
  insert.run(
    5,
    "lighthouse_festival",
    "flag",
    "red",
    "critical",
    "등대 축제에서 붉은 깃발을 걸었다."
  );
  insert.run(
    50,
    "lighthouse_storage",
    "box",
    "blue",
    "normal",
    "등대 창고에서 푸른 상자를 발견했다."
  );
  return db;
}

it("omitted packing/selection/scoring arms match the lexical baseline", async () => {
  const baseline = await runBenchmarkCases(BASELINE_MODE, transportProbe);
  const explicitEmpty = await runBenchmarkCases(
    { ...BASELINE_MODE, label: "explicit-empty-hooks", packing: {}, selection: {}, scoring: {} },
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

it("reranking_scoring changes only final rank weights after the same relevance gate", () => {
  const db = createScoringDb();
  try {
    const baseline = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 60,
        currentUserMessage: "등대에서 있었던 일을 기억해?",
        maxFacts: 1,
      },
      recallEnv
    );
    const recencyHeavy = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 60,
        currentUserMessage: "등대에서 있었던 일을 기억해?",
        maxFacts: 1,
        rerankingPolicy: {
          importanceWeight: 0,
          milestoneBonus: 0,
          recencyWeight: 20,
        },
      },
      recallEnv
    );

    const baselinePassIds = baseline.debug
      .filter((row) => row.relevance_pass)
      .map((row) => row.id)
      .sort((a, b) => a - b);
    const recencyPassIds = recencyHeavy.debug
      .filter((row) => row.relevance_pass)
      .map((row) => row.id)
      .sort((a, b) => a - b);

    assert.deepEqual(
      recencyPassIds,
      baselinePassIds,
      "scoring weights must not alter candidate admission / relevance-pass membership"
    );
    assert.equal(baseline.facts.length, 1);
    assert.equal(recencyHeavy.facts.length, 1);
    assert.match(baseline.facts[0]!.fact_text, /붉은 깃발/);
    assert.match(recencyHeavy.facts[0]!.fact_text, /푸른 상자/);
    assert.notEqual(
      baseline.debug.find((row) => row.final_rank === 1)?.id,
      recencyHeavy.debug.find((row) => row.final_rank === 1)?.id,
      "the A/B arm must exercise the actual final scorer rather than selection bounds"
    );
    assert.equal(httpCallsObserved, 0);
  } finally {
    db.close();
  }
});

it("empty reranking policy resolves exactly to the production scoring weights", () => {
  assert.deepEqual(resolveEpisodicRerankingPolicy(), {
    lexicalWeight: 4,
    importanceWeight: 1,
    recencyWeight: 1,
    milestoneBonus: 2,
  });
  assert.deepEqual(resolveEpisodicRerankingPolicy({}), {
    lexicalWeight: 4,
    importanceWeight: 1,
    recencyWeight: 1,
    milestoneBonus: 2,
  });
});

it("BenchmarkMode.scoring is a bounded research-only reranking arm", () => {
  const mode = scoringMode("recency-heavy-reranking", {
    importanceWeight: 0,
    milestoneBonus: 0,
    recencyWeight: 20,
  });
  assert.deepEqual(mode.scoring, {
    importanceWeight: 0,
    milestoneBonus: 0,
    recencyWeight: 20,
  });
  assert.deepEqual(resolveEpisodicRerankingPolicy({ recencyWeight: 999 }), {
    lexicalWeight: 4,
    importanceWeight: 1,
    recencyWeight: 20,
    milestoneBonus: 2,
  });
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
