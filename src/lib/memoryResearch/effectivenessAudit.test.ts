import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMemoryResearchEffectivenessAudit,
  renderMemoryResearchEffectivenessMarkdown,
} from "@/lib/memoryResearch/effectivenessAudit";
import type {
  CandidateDecisionCode,
  ResearchCandidate,
  ResearchSourceKind,
} from "@/lib/memoryResearch/types";

function candidate(input: {
  key: string;
  sourceKind: ResearchSourceKind;
  state: ResearchCandidate["state"];
  decision: CandidateDecisionCode | null;
  cooldownUntil?: string | null;
  evaluations?: CandidateDecisionCode[];
  draftPrUrl?: string | null;
  implementationPrUrl?: string | null;
  live?: boolean;
}): ResearchCandidate {
  const now = "2026-09-01T00:00:00.000Z";
  return {
    candidateKey: input.key,
    category: "companion_roleplay_memory",
    sourceKind: input.sourceKind,
    sourceUrl: "https://example.invalid/" + input.key,
    title: input.key,
    version: "v1",
    discoveredAt: now,
    lastSeenAt: now,
    summary: "fixture",
    claimedAdvantage: "fixture",
    applicableOwners: ["episodic_facts"],
    expectedBenefit: "fixture",
    expectedCost: "none",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state: input.state,
    lastDecision: input.decision,
    lastDecisionReason: "fixture",
    priorRejectionReason: input.state === "REJECTED" ? "fixture" : null,
    reevaluationCondition: "fixture",
    cooldownUntil: input.cooldownUntil ?? null,
    evaluations: (input.evaluations ?? (input.decision ? [input.decision] : [])).map(
      (decision, index) => ({
        cycleKey: "weekly-fixture-" + index,
        evaluatedAt: now,
        version: "v1",
        adapterFingerprint: null,
        architectureFingerprint: "arch",
        state: input.state,
        decision,
        reason: "fixture",
        stateTrail: ["RESEARCHED", input.state],
      })
    ),
    draftPrUrl: input.draftPrUrl ?? null,
    implementationPrUrl: input.implementationPrUrl ?? null,
    liveExperiment: input.live
      ? {
          recipeId: "fixture",
          recipeVersion: "v1",
          evaluatedAt: "2026-09-20T00:00:00.000Z",
          referenceModel: "ref",
          candidateModel: "cand",
          gateDecision: "WATCH_IMPLEMENTATION_PR_PENDING",
          gateReason: "fixture",
          referenceMetrics: "fixture",
          candidateMetrics: "fixture",
          candidateCostUsdPer1kTurns: 0.1,
          referenceCostUsdPer1kTurns: 0.2,
          queryP95DeltaMs: 10,
        }
      : null,
  };
}

describe("Memory Research Effectiveness Audit", () => {
  it("reports source funnel, WATCH bottlenecks, repeated WATCH, and due cooldowns without mutating candidates", () => {
    const candidates: Record<string, ResearchCandidate> = {
      a: candidate({
        key: "github:a",
        sourceKind: "github_repository",
        state: "WATCH",
        decision: "WATCH_NO_BENCHMARK_HOOK",
        cooldownUntil: "2026-09-25T00:00:00.000Z",
        evaluations: [
          "WATCH_NO_BENCHMARK_HOOK",
          "WATCH_NO_BENCHMARK_HOOK",
        ],
      }),
      b: candidate({
        key: "github:b",
        sourceKind: "github_repository",
        state: "ACCEPTED",
        decision: "ACCEPTED_QUALITY_GAIN",
        draftPrUrl: "https://github.com/example/repo/pull/1",
      }),
      c: candidate({
        key: "arxiv:c",
        sourceKind: "arxiv",
        state: "REJECTED",
        decision: "REJECTED_OWNER_CONFLICT",
      }),
      d: candidate({
        key: "official:d",
        sourceKind: "official_companion_docs",
        state: "WATCH",
        decision: "WATCH_NO_EXPERIMENT_ADAPTER",
        cooldownUntil: "2026-12-01T00:00:00.000Z",
        implementationPrUrl: "https://github.com/example/repo/pull/2",
        live: true,
      }),
    };
    const before = JSON.stringify(candidates);

    const audit = buildMemoryResearchEffectivenessAudit(
      candidates,
      new Date("2026-09-30T00:00:00.000Z")
    );

    assert.equal(JSON.stringify(candidates), before);
    assert.equal(audit.totalCandidates, 4);
    assert.equal(audit.watch, 2);
    assert.equal(audit.rejected, 1);
    assert.equal(audit.accepted, 1);
    assert.equal(audit.acceptedDraftPrs, 1);
    assert.equal(audit.implementationPrs, 1);
    assert.equal(audit.liveEvaluated, 1);
    assert.deepEqual(audit.dueForReevaluation, ["github:a"]);
    assert.deepEqual(audit.repeatedWatch, [
      {
        candidateKey: "github:a",
        decision: "WATCH_NO_BENCHMARK_HOOK",
        consecutiveSameDecision: 2,
      },
    ]);
    assert.deepEqual(
      audit.watchBottlenecks.map((row) => [row.decision, row.candidates]),
      [
        ["WATCH_NO_BENCHMARK_HOOK", 1],
        ["WATCH_NO_EXPERIMENT_ADAPTER", 1],
      ]
    );

    const github = audit.bySourceKind.find(
      (row) => row.sourceKind === "github_repository"
    );
    assert.ok(github);
    assert.equal(github.candidates, 2);
    assert.equal(github.watch, 1);
    assert.equal(github.accepted, 1);
    assert.equal(github.acceptedDraftPrs, 1);
  });

  it("does not label a source good/bad or auto-change research policy", () => {
    const audit = buildMemoryResearchEffectivenessAudit(
      {
        one: candidate({
          key: "arxiv:one",
          sourceKind: "arxiv",
          state: "REJECTED",
          decision: "REJECTED_NO_QUALITY_GAIN",
        }),
      },
      new Date("2026-09-30T00:00:00.000Z")
    );
    assert.match(audit.note, /does not prove a source is low quality/i);
    const markdown = renderMemoryResearchEffectivenessMarkdown(audit);
    assert.match(markdown, /Memory Research Effectiveness Audit/);
    assert.match(markdown, /Source-kind funnel/);
    assert.doesNotMatch(markdown, /best source|worst source|disable source/i);
  });

  it("returns an empty descriptive audit for an empty ledger", () => {
    const audit = buildMemoryResearchEffectivenessAudit(
      {},
      new Date("2026-09-30T00:00:00.000Z")
    );
    assert.equal(audit.totalCandidates, 0);
    assert.deepEqual(audit.bySourceKind, []);
    assert.deepEqual(audit.watchBottlenecks, []);
    assert.deepEqual(audit.dueForReevaluation, []);
    assert.deepEqual(audit.repeatedWatch, []);
  });
});
