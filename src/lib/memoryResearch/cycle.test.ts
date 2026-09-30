import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { BASELINE_MODE } from "@/lib/memory/memory-rp-benchmark-suite";
import { runLabArm } from "@/lib/memoryResearch/benchmarkLab";
import { baselinePromotionGateFor, cycleKeyFor, runResearchCycle, type CycleDeps } from "@/lib/memoryResearch/cycle";
import type { ExperimentAdapter } from "@/lib/memoryResearch/experiments";
import { applyDraftPrResults, emptyLedger, parseLedger, serializeLedger, type ResearchLedger } from "@/lib/memoryResearch/ledger";
import { narrowSyntheticAdapter, observation, wideSyntheticAdapter } from "@/lib/memoryResearch/labFixtures.test";
import { computeArchitectureFingerprint } from "@/lib/memoryResearch/ownerMap";
import { missingPacketSections } from "@/lib/memoryResearch/prPacket";
import { githubWatchlistSource, GITHUB_WATCHLIST, type SourceAdapter } from "@/lib/memoryResearch/sources";
import type { ResearchObservation } from "@/lib/memoryResearch/types";

const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";
const WEEK1 = new Date("2026-09-28T01:17:00Z");
const WEEK2 = new Date("2026-10-05T01:17:00Z");
const WEEK3 = new Date("2026-10-12T01:17:00Z");

function staticSource(id: string, observations: ResearchObservation[]): SourceAdapter {
  return { id, kind: "github_repository", collect: async () => ({ sourceId: id, observations, errors: [] }) };
}

const throwingSource: SourceAdapter = {
  id: "broken_source",
  kind: "arxiv",
  collect: async () => {
    throw new Error("source adapter crashed");
  },
};

const OBS = {
  wide: observation({ candidateKey: "github:fixture/wide", version: "v1.0.0" }),
  narrow: observation({ candidateKey: "github:fixture/narrow", version: "v1.0.0" }),
  noAdapter: observation({ candidateKey: "github:fixture/embedding-no-adapter", version: "v3" }),
  graphInfra: observation({ candidateKey: "github:fixture/graph", category: "graph_memory", infraRequirements: ["graph_database"] }),
};

const ADAPTERS: ExperimentAdapter[] = [
  wideSyntheticAdapter("github:fixture/wide"),
  narrowSyntheticAdapter("github:fixture/narrow"),
];

function deps(now: Date, overrides: Partial<CycleDeps> = {}): CycleDeps {
  return {
    mode: "weekly",
    now,
    mainSha: MAIN_SHA,
    architectureFingerprint: "arch-fixture",
    benchmarkFingerprint: "benchmark-fixture",
    sources: [
      staticSource("fixture_primary", [OBS.wide, OBS.narrow, OBS.noAdapter, OBS.graphInfra]),
      staticSource("fixture_secondary", [OBS.wide]),
      throwingSource,
      githubWatchlistSource(GITHUB_WATCHLIST.slice(0, 1)),
    ],
    sourceContext: {
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.github.com");
      },
      budget: { limit: 40, used: 0 },
      now,
      githubToken: null,
      sleep: async () => {},
    },
    adapters: ADAPTERS,
    runArm: runLabArm,
    ...overrides,
  };
}

function roundTrip(ledger: ResearchLedger): ResearchLedger {
  return parseLedger(serializeLedger(ledger));
}

it("cycle keys: ISO week for weekly, calendar month for monthly deep review", () => {
  assert.equal(cycleKeyFor("weekly", WEEK1), "weekly-2026-W40");
  assert.equal(cycleKeyFor("weekly", new Date("2027-01-01T00:00:00Z")), "weekly-2026-W53");
  assert.equal(cycleKeyFor("monthly_deep", WEEK1), "monthly-2026-09");
});

it("full cycle: isolation, dedupe, screening, real benchmark gates, ACCEPTED-only complete Draft PR packet", async () => {
  const archBefore = computeArchitectureFingerprint((p) => readFileSync(p, "utf8"));
  const { ledger, report } = await runResearchCycle(emptyLedger(), deps(WEEK1));

  assert.equal(report.status, "COMPLETED");
  assert.equal(report.counts.sourcesChecked, 4);
  assert.equal(report.counts.sourcesFailed, 2, "throwing adapter + network-failing adapter");
  assert.match(report.sources.find((s) => s.sourceId === "broken_source")!.errors[0]!, /crashed/);
  assert.match(report.sources.find((s) => s.sourceId === "github_watchlist")!.errors[0]!, /ENOTFOUND/);
  assert.equal(report.counts.observations, 5);
  assert.equal(report.counts.newCandidates, 4);
  assert.equal(report.counts.skippedDuplicates, 1);
  assert.deepEqual(report.skipped, [{ candidateKey: "github:fixture/wide", reason: "duplicate_in_cycle" }]);
  assert.equal(report.baseline.status, "RAN");
  assert.equal(report.baselineTrend.status, "NO_HISTORY");
  assert.equal(ledger.cycles[0]?.baseline?.benchmarkFingerprint, "benchmark-fixture");

  const byKey = Object.fromEntries(report.decisions.map((d) => [d.candidateKey, d]));
  assert.equal(byKey["github:fixture/wide"]!.decision, "ACCEPTED_QUALITY_GAIN");
  assert.deepEqual(byKey["github:fixture/wide"]!.trail, ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", "ACCEPTED"]);
  assert.equal(byKey["github:fixture/narrow"]!.decision, "REJECTED_FALSE_MEMORY_REGRESSION");
  assert.equal(byKey["github:fixture/embedding-no-adapter"]!.decision, "WATCH_NO_EXPERIMENT_ADAPTER");
  assert.equal(byKey["github:fixture/graph"]!.decision, "REJECTED_INFRA_COMPLEXITY");
  assert.deepEqual(
    [report.counts.watch, report.counts.reject, report.counts.benchmarked, report.counts.accept],
    [1, 2, 2, 1]
  );

  assert.equal(report.draftPrPackets.length, 1, "quality regression never yields a Draft PR");
  const packet = report.draftPrPackets[0]!;
  assert.equal(packet.candidateKey, "github:fixture/wide");
  assert.equal(packet.decision, "ACCEPTED_QUALITY_GAIN");
  assert.deepEqual(missingPacketSections(packet.body), []);
  assert.match(packet.body, new RegExp(MAIN_SHA));
  assert.match(packet.body, /falseMemoryRate \| 0 \| 0 \| 0/);
  assert.doesNotMatch(packet.body, /\/100|total score/i, "raw metrics only, no composite score");
  assert.deepEqual(report.cleanupCandidates, ["github:fixture/narrow@1"]);

  assert.equal(report.providerCalls.paidProviderCalls, 0);
  assert.equal(report.estimatedCostUsd, 0);
  assert.equal(report.productionTouched, false);
  assert.equal(ledger.candidates["github:fixture/narrow"]!.priorRejectionReason, byKey["github:fixture/narrow"]!.reason);
  assert.equal(ledger.cycles.length, 1);
  assert.equal(
    computeArchitectureFingerprint((p) => readFileSync(p, "utf8")),
    archBefore,
    "a research cycle alone never changes production memory owners"
  );
});

it("baseline regression fail-closes candidate promotion while discovery/evidence continues", async () => {
  const first = await runResearchCycle(emptyLedger(), deps(WEEK1));
  const beforeWide = first.ledger.candidates["github:fixture/wide"]!;
  const beforeNarrow = first.ledger.candidates["github:fixture/narrow"]!;

  let nonBaselineArmCalls = 0;
  const regressedRunArm: NonNullable<CycleDeps["runArm"]> = async (mode) => {
    const result = await runLabArm(mode);
    if (mode.label !== BASELINE_MODE.label) {
      nonBaselineArmCalls += 1;
      return result;
    }
    assert.equal(result.status, "RAN");
    const positive = Object.entries(result.summary.finalHitByCase).find(([, hit]) => hit);
    assert.ok(positive, "fixture baseline must contain at least one positive final-hit case");
    const finalHitByCase = {
      ...result.summary.finalHitByCase,
      [positive[0]]: false,
    };
    return {
      status: "RAN",
      summary: {
        ...result.summary,
        finalHitByCase,
      },
    };
  };

  const second = await runResearchCycle(
    roundTrip(first.ledger),
    deps(WEEK2, { runArm: regressedRunArm })
  );

  assert.equal(second.report.baseline.status, "RAN");
  assert.equal(second.report.baselineTrend.status, "REGRESSION");
  assert.equal(second.report.baselinePromotionGate.status, "BLOCKED_REGRESSION");
  assert.equal(second.report.baselinePromotionGate.blocked, true);
  assert.ok(second.report.baselineTrend.lostPositiveCases.length > 0);
  assert.equal(nonBaselineArmCalls, 0, "candidate A/B arms must not run while baseline promotion is blocked");
  assert.equal(second.report.counts.benchmarked, 0);
  assert.equal(second.report.counts.accept, 0);
  assert.equal(second.report.draftPrPackets.length, 0);
  assert.ok(
    second.report.skipped.some(
      (row) =>
        row.candidateKey === "github:fixture/wide" &&
        row.reason === "baseline_promotion_gate"
    )
  );
  assert.equal(
    second.ledger.candidates["github:fixture/wide"]!.lastDecision,
    beforeWide.lastDecision,
    "blocked cycle must not rewrite an existing candidate decision"
  );
  assert.equal(
    second.ledger.candidates["github:fixture/narrow"]!.lastDecision,
    beforeNarrow.lastDecision,
    "blocked cycle must not rewrite rejected evidence"
  );
  assert.equal(
    second.ledger.cycles.at(-1)?.baseline?.benchmarkFingerprint,
    "benchmark-fixture",
    "regressed baseline snapshot must still persist for incident evidence"
  );
});

it("mixed baseline trend also blocks promotion", async () => {
  const gate = baselinePromotionGateFor("RAN", "MIXED");
  assert.equal(gate.status, "BLOCKED_MIXED");
  assert.equal(gate.blocked, true);
});

it("failed baseline blocks downstream promotion", () => {
  const gate = baselinePromotionGateFor("FAILED", "BASELINE_FAILED");
  assert.equal(gate.status, "BLOCKED_BASELINE_FAILED");
  assert.equal(gate.blocked, true);
});

it("next cycles: rejected same-version skipped, ACCEPTED re-emits until its Draft PR exists, new release re-evaluates", async () => {
  const first = await runResearchCycle(emptyLedger(), deps(WEEK1));

  const second = await runResearchCycle(roundTrip(first.ledger), deps(WEEK2));
  assert.equal(second.report.baselineTrend.status, "STABLE");
  assert.equal(second.report.baselineTrend.previousCycleKey, "weekly-2026-W40");
  const skipped2 = Object.fromEntries(second.report.skipped.map((s) => [s.candidateKey, s.reason]));
  assert.equal(skipped2["github:fixture/narrow"], "rejected_same_version");
  assert.equal(skipped2["github:fixture/graph"], "rejected_same_version");
  assert.equal(skipped2["github:fixture/embedding-no-adapter"], "watch_cooldown");
  assert.equal(second.report.decisions.find((d) => d.candidateKey === "github:fixture/wide")?.trigger, "draft_pr_retry");
  assert.equal(second.report.counts.benchmarked, 1, "only the PR-retry candidate is re-benchmarked");

  const withPr = applyDraftPrResults(roundTrip(second.ledger), [
    { candidateKey: "github:fixture/wide", url: "https://github.com/o/r/pull/9", error: null },
  ]);
  const newRelease = observation({ candidateKey: "github:fixture/narrow", version: "v1.1.0" });
  const third = await runResearchCycle(
    withPr,
    deps(WEEK3, { sources: [staticSource("fixture_primary", [OBS.wide, newRelease, OBS.graphInfra])] })
  );
  const skipped3 = Object.fromEntries(third.report.skipped.map((s) => [s.candidateKey, s.reason]));
  assert.equal(skipped3["github:fixture/wide"], "accepted_pending_review");
  assert.equal(third.report.draftPrPackets.length, 0, "no duplicate Draft PR once one exists");
  const narrow = third.report.decisions.find((d) => d.candidateKey === "github:fixture/narrow")!;
  assert.equal(narrow.trigger, "new_version");
  assert.equal(narrow.decision, "REJECTED_FALSE_MEMORY_REGRESSION");
  assert.equal(third.ledger.candidates["github:fixture/narrow"]!.version, "v1.1.0");
  assert.equal(third.ledger.candidates["github:fixture/narrow"]!.evaluations.length, 2);
});


it("companion bridge emits proposals only when the official-doc candidate is actually re-evaluated", async () => {
  const official: ResearchObservation = {
    candidateKey: "official:kindroid:memory-docs",
    sourceKind: "official_companion_docs",
    sourceUrl: "https://kindroid.ai/docs/article/llm-guides/",
    title: "Kindroid official memory docs",
    version: "docs-v1",
    publishedAt: null,
    summary:
      "Cascaded summarized history keeps older context. Long-term memory recalls up to nine journal entries.",
    claimedAdvantage: "bounded journal recall plus cascaded summarized context",
    category: "companion_roleplay_memory",
    evidence: {
      hasReproducibleCode: false,
      hasPublishedBenchmark: false,
      archived: false,
      lastActivityAt: null,
    },
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  };
  const source: SourceAdapter = {
    id: "official_companion_memory_docs",
    kind: "official_companion_docs",
    collect: async () => ({
      sourceId: "official_companion_memory_docs",
      observations: [official],
      errors: [],
    }),
  };

  const first = await runResearchCycle(
    emptyLedger(),
    deps(WEEK1, { sources: [source], adapters: [] })
  );
  assert.equal(first.report.decisions[0]?.decision, "WATCH_INSUFFICIENT_EVIDENCE");
  assert.deepEqual(
    first.report.companionExperimentProposals.map((proposal) => proposal.technique).sort(),
    ["bounded_long_term_recall", "cascaded_summary_history"]
  );

  const second = await runResearchCycle(
    roundTrip(first.ledger),
    deps(WEEK2, { sources: [source], adapters: [] })
  );
  assert.equal(second.report.skipped[0]?.reason, "watch_cooldown");
  assert.equal(
    second.report.companionExperimentProposals.length,
    0,
    "unchanged official docs must not repeat the same bridge proposal every weekly cycle"
  );
});


it("benchmark adoption proposals emit only when a benchmark candidate is re-evaluated", async () => {
  const benchmark: ResearchObservation = {
    candidateKey: "github:salesforceairesearch/anchorbench",
    sourceKind: "github_repository",
    sourceUrl: "https://github.com/SalesforceAIResearch/AnchorBench",
    title: "SalesforceAIResearch/AnchorBench",
    version: "fixture-v1",
    publishedAt: null,
    summary: "persona continuity and trajectory recall benchmark",
    claimedAdvantage:
      "persona continuity across role, boundaries, values and style; trajectory recall for active and expired commitments",
    category: "memory_benchmark",
    evidence: {
      hasReproducibleCode: true,
      hasPublishedBenchmark: true,
      archived: false,
      lastActivityAt: "2026-09-01T00:00:00Z",
    },
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  };
  const source = staticSource("benchmark_fixture", [benchmark]);

  const first = await runResearchCycle(
    emptyLedger(),
    deps(WEEK1, { sources: [source], adapters: [] })
  );
  assert.equal(first.report.decisions[0]?.decision, "WATCH_NO_BENCHMARK_HOOK");
  assert.deepEqual(
    first.report.benchmarkAdoptionProposals.map((proposal) => proposal.ability).sort(),
    ["persona_continuity", "trajectory_recall"]
  );
  assert.deepEqual(
    first.report.benchmarkCasePortPlans
      .map((plan) => [plan.planKey, plan.readiness])
      .sort(),
    [
      ["persona_continuity", "HARNESS_EXTENSION_REQUIRED"],
      ["trajectory_recall:commitment_lifecycle", "NO_PORT_REQUIRED"],
      ["trajectory_recall:existing_temporal_user_state", "NO_PORT_REQUIRED"],
      ["trajectory_recall:persona_update", "HARNESS_EXTENSION_REQUIRED"],
    ]
  );
  assert.deepEqual(
    first.report.benchmarkHarnessFeasibility
      .map((row) => [row.planKey, row.status])
      .sort(),
    [
      ["persona_continuity", "LLM_JUDGE_REQUIRED"],
      ["trajectory_recall:commitment_lifecycle", "NO_ACTION"],
      ["trajectory_recall:existing_temporal_user_state", "NO_ACTION"],
      ["trajectory_recall:persona_update", "OWNER_UNRESOLVED"],
    ]
  );

  const second = await runResearchCycle(
    roundTrip(first.ledger),
    deps(WEEK2, { sources: [source], adapters: [] })
  );
  assert.equal(second.report.skipped[0]?.reason, "watch_cooldown");
  assert.equal(
    second.report.benchmarkAdoptionProposals.length,
    0,
    "unchanged benchmark capabilities must not repeat adoption proposals every weekly cycle"
  );
  assert.equal(
    second.report.benchmarkCasePortPlans.length,
    0,
    "unchanged benchmark capabilities must not repeat case-port plans every weekly cycle"
  );
  assert.equal(
    second.report.benchmarkHarnessFeasibility.length,
    0,
    "unchanged benchmark capabilities must not repeat harness-feasibility evidence every weekly cycle"
  );
});

it("same cycle key is idempotent unless forced", async () => {
  const first = await runResearchCycle(emptyLedger(), deps(WEEK1, { sources: [staticSource("s", [OBS.noAdapter])] }));
  const again = await runResearchCycle(first.ledger, deps(WEEK1, { sources: [staticSource("s", [OBS.noAdapter])] }));
  assert.equal(again.report.status, "SKIPPED_ALREADY_RAN");
  assert.equal(again.ledger, first.ledger);
  const forced = await runResearchCycle(first.ledger, deps(WEEK1, { sources: [staticSource("s", [OBS.noAdapter])], force: true }));
  assert.equal(forced.report.status, "COMPLETED");
  assert.equal(forced.report.skipped[0]?.reason, "watch_cooldown");
});

it("benchmark failure isolation: failed baseline freezes promotion; crashing candidate arm remains WATCH", async () => {
  const failingBaseline = await runResearchCycle(
    emptyLedger(),
    deps(WEEK1, {
      sources: [staticSource("s", [OBS.wide])],
      runArm: async (mode) => ({ status: "FAILED", label: mode.label, error: "invariant#3 failed", httpCallsAttempted: 0 }),
    })
  );
  assert.equal(failingBaseline.report.baseline.status, "FAILED");
  assert.equal(failingBaseline.report.baselinePromotionGate.status, "BLOCKED_BASELINE_FAILED");
  assert.equal(failingBaseline.report.decisions.length, 0);
  assert.deepEqual(failingBaseline.report.skipped, [
    { candidateKey: "github:fixture/wide", reason: "baseline_promotion_gate" },
  ]);
  assert.equal(failingBaseline.ledger.candidates["github:fixture/wide"], undefined);
  assert.equal(failingBaseline.report.draftPrPackets.length, 0);

  const crashing: ExperimentAdapter = {
    ...wideSyntheticAdapter("github:fixture/wide"),
    buildMode: () => {
      throw new Error("adapter bug");
    },
  };
  const crashed = await runResearchCycle(
    emptyLedger(),
    deps(WEEK1, { sources: [staticSource("s", [OBS.wide])], adapters: [crashing] })
  );
  assert.equal(crashed.report.baselinePromotionGate.status, "OPEN");
  assert.equal(crashed.report.decisions[0]!.decision, "WATCH_BENCHMARK_FAILED");
  assert.match(crashed.report.decisions[0]!.reason, /adapter bug/);
  assert.equal(crashed.report.draftPrPackets.length, 0);
});


it("schemaVersion=1 research ledger remains backward-compatible without baseline snapshots", () => {
  const legacy = JSON.stringify({
    schemaVersion: 1,
    candidates: {},
    cycles: [
      {
        cycleKey: "weekly-2026-W39",
        mode: "weekly",
        finishedAt: "2026-09-21T01:17:00.000Z",
        mainSha: MAIN_SHA,
        counts: { evaluated: 0 },
      },
    ],
  });
  const parsed = parseLedger(legacy);
  assert.equal(parsed.cycles.length, 1);
  assert.equal(parsed.cycles[0]?.baseline, undefined);
  const reparsed = parseLedger(serializeLedger(parsed));
  assert.equal(reparsed.cycles[0]?.baseline, undefined);
});

it("ledger rejects unknown schema and round-trips deterministically", async () => {
  assert.throws(() => parseLedger('{"schemaVersion":2,"candidates":{},"cycles":[]}'), /schemaVersion/);
  assert.deepEqual(parseLedger(null), emptyLedger());
  const { ledger } = await runResearchCycle(emptyLedger(), deps(WEEK1, { sources: [staticSource("s", [OBS.graphInfra, OBS.noAdapter])] }));
  assert.equal(serializeLedger(parseLedger(serializeLedger(ledger))), serializeLedger(ledger));
});


it("workflow fail-closes Draft/live/implementation promotion while persist still records regression evidence", () => {
  const workflow = readFileSync(".github/workflows/memory-research-cycle.yml", "utf8");
  const script = readFileSync("scripts/memory-research-cycle.ts", "utf8");
  const guard = "needs.research.outputs.baseline_promotion_blocked != 'true'";

  assert.match(workflow, /baseline_promotion_blocked/);
  assert.match(workflow, /baseline_promotion_gate_status/);
  assert.match(script, /writeOutput\("baseline_promotion_blocked"/);
  assert.match(script, /writeOutput\("baseline_promotion_gate_status"/);
  assert.equal(
    workflow.split(guard).length - 1,
    3,
    "draft_prs, live_experiments, and implementation_prs must all require the gate"
  );

  const draftStart = workflow.indexOf("\n  draft_prs:");
  const liveStart = workflow.indexOf("\n  live_experiments:");
  const implementationStart = workflow.indexOf("\n  implementation_prs:");
  const persistStart = workflow.indexOf("\n  persist:");
  assert.ok(
    draftStart > 0 &&
      liveStart > draftStart &&
      implementationStart > liveStart &&
      persistStart > implementationStart
  );
  assert.ok(workflow.slice(draftStart, liveStart).includes(guard));
  assert.ok(workflow.slice(liveStart, implementationStart).includes(guard));
  assert.ok(workflow.slice(implementationStart, persistStart).includes(guard));
  assert.ok(
    !workflow.slice(persistStart).includes(guard),
    "persist must remain open so the regressed baseline snapshot is retained"
  );
});
