import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BaselineSnapshot } from "@/lib/memoryResearch/baselineTrend";
import { emptyLedger, type ResearchLedger } from "@/lib/memoryResearch/ledger";
import {
  buildPersistentGapLivePriority,
  renderPersistentGapExperimentRoutesMarkdown,
} from "@/lib/memoryResearch/persistentGapExperimentRouter";
import { findLiveExperimentRecipe } from "@/lib/memoryResearch/liveExperimentRecipes";
import type { ResearchCandidate } from "@/lib/memoryResearch/types";

const SEMANTIC_CASE = "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01";
const QWEN_KEY = "github:qwenlm/qwen3-embedding";

function baseline(finalHitByCase: Record<string, boolean>): BaselineSnapshot {
  return {
    benchmarkFingerprint: "fp-a",
    cases: Object.keys(finalHitByCase).length,
    evaluatedTurns: 1,
    promptTokensPerTurn: 0,
    invariantViolationCount: 0,
    metrics: {} as BaselineSnapshot["metrics"],
    finalHitByCase,
  };
}

function candidate(
  key: string,
  decision: ResearchCandidate["lastDecision"] = "WATCH_LIVE_EXPERIMENT_PENDING"
): ResearchCandidate {
  return {
    candidateKey: key,
    category: "embedding_model",
    sourceKind: "github_repository",
    sourceUrl: "https://example.invalid/" + encodeURIComponent(key),
    title: key,
    version: null,
    discoveredAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
    summary: "",
    claimedAdvantage: "",
    applicableOwners: ["embedding_index"],
    expectedBenefit: "",
    expectedCost: "",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state: decision === "REJECTED_NO_QUALITY_GAIN" ? "REJECTED" : "WATCH",
    lastDecision: decision,
    lastDecisionReason: "",
    priorRejectionReason: null,
    reevaluationCondition: "",
    cooldownUntil: null,
    evaluations: [],
    draftPrUrl: null,
  };
}

function ledgerWithPersistentGap(
  caseId: string,
  qwenDecision: ResearchCandidate["lastDecision"] = "WATCH_LIVE_EXPERIMENT_PENDING"
): ResearchLedger {
  const ledger = emptyLedger();
  ledger.candidates[QWEN_KEY] = candidate(QWEN_KEY, qwenDecision);
  ledger.cycles = [
    { cycleKey: "weekly-1", mode: "weekly", finishedAt: "2026-09-01T00:00:00Z", mainSha: "a".repeat(40), counts: {}, baseline: baseline({ [caseId]: false }) },
    { cycleKey: "weekly-2", mode: "weekly", finishedAt: "2026-09-08T00:00:00Z", mainSha: "b".repeat(40), counts: {}, baseline: baseline({ [caseId]: false }) },
    { cycleKey: "weekly-3", mode: "weekly", finishedAt: "2026-09-15T00:00:00Z", mainSha: "c".repeat(40), counts: {}, baseline: baseline({ [caseId]: false }) },
  ];
  return ledger;
}

describe("Persistent Gap Experiment Router", () => {
  it("prioritizes an already-reviewed pending live recipe on the same owner", () => {
    const out = buildPersistentGapLivePriority(ledgerWithPersistentGap(SEMANTIC_CASE));
    assert.equal(out.gapReport.status, "PERSISTENT_GAPS");
    assert.deepEqual(out.priorityCandidateKeys, [QWEN_KEY]);
    assert.deepEqual(out.gapCaseIdsByCandidateKey[QWEN_KEY], [SEMANTIC_CASE]);
    assert.equal(out.routes[0]!.status, "READY_LIVE_PRIORITY");
    assert.deepEqual(out.routes[0]!.recipeIds, ["qwen3-embedding-vs-bge-m3"]);
  });

  it("does not override lifecycle state when a matching candidate is not pending", () => {
    const ledger = ledgerWithPersistentGap(SEMANTIC_CASE, "WATCH_IMPLEMENTATION_PR_PENDING");
    const out = buildPersistentGapLivePriority(ledger);
    assert.deepEqual(out.priorityCandidateKeys, []);
    assert.equal(out.routes[0]!.status, "REGISTERED_ASSET_NOT_PENDING");
  });

  it("does not synthesize a candidate when only a recipe exists", () => {
    const ledger = ledgerWithPersistentGap(SEMANTIC_CASE);
    delete ledger.candidates[QWEN_KEY];
    const out = buildPersistentGapLivePriority(ledger);
    assert.deepEqual(out.priorityCandidateKeys, []);
    assert.equal(out.routes[0]!.status, "REGISTERED_ASSET_CANDIDATE_NOT_DISCOVERED");
  });

  it("stops on an unexpected gap with no proven owner hint", () => {
    const out = buildPersistentGapLivePriority(ledgerWithPersistentGap("t300-01"));
    assert.deepEqual(out.priorityCandidateKeys, []);
    assert.equal(out.routes[0]!.status, "OWNER_ROUTING_REQUIRED");
    assert.match(out.routes[0]!.reason, /Do not prioritize or invent/);
  });

  it("keeps a well-owned gap visible when there is no reviewed live recipe", () => {
    const out = buildPersistentGapLivePriority(ledgerWithPersistentGap("item-ownership-01"));
    assert.deepEqual(out.priorityCandidateKeys, []);
    assert.equal(out.routes[0]!.status, "NO_REGISTERED_LIVE_RECIPE");
    assert.match(out.routes[0]!.reason, /do not auto-create a recipe/i);
  });

  it("does nothing before the 3-cycle persistence gate is met", () => {
    const ledger = ledgerWithPersistentGap(SEMANTIC_CASE);
    ledger.cycles = ledger.cycles.slice(1);
    const out = buildPersistentGapLivePriority(ledger);
    assert.equal(out.gapReport.status, "INSUFFICIENT_HISTORY");
    assert.deepEqual(out.routes, []);
    assert.deepEqual(out.priorityCandidateKeys, []);
  });

  it("renders routing evidence without claiming a new experiment was created", () => {
    const out = buildPersistentGapLivePriority(ledgerWithPersistentGap(SEMANTIC_CASE));
    const markdown = renderPersistentGapExperimentRoutesMarkdown(out);
    assert.match(markdown, /Persistent Gap Experiment Router/);
    assert.match(markdown, /READY_LIVE_PRIORITY/);
    assert.match(markdown, /github:qwenlm\/qwen3-embedding/);
    assert.doesNotMatch(markdown, /created new recipe|auto-created/i);
    assert.ok(findLiveExperimentRecipe(QWEN_KEY));
  });
});
