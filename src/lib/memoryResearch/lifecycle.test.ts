import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assertValidTrail,
  canTransition,
  cooldownUntilFor,
  decideReevaluation,
  decisionState,
  WATCH_COOLDOWN_DAYS,
} from "@/lib/memoryResearch/lifecycle";
import { observation } from "@/lib/memoryResearch/labFixtures.test";
import type { CandidateLifecycleState, ResearchCandidate } from "@/lib/memoryResearch/types";
import { architectureFingerprintPaths } from "@/lib/memoryResearch/ownerMap";

const now = new Date("2026-09-28T01:17:00Z");
const ctx = { now, adapterFingerprint: null, architectureFingerprint: "arch-1", deepReview: false };

function candidate(state: CandidateLifecycleState, overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  const trail: CandidateLifecycleState[] =
    state === "ACCEPTED" || (overrides.lastDecision ?? "").startsWith("REJECTED_NO")
      ? ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", state]
      : ["RESEARCHED", "SCREENED", state];
  return {
    candidateKey: "github:x/y",
    category: "embedding_model",
    sourceKind: "github_repository",
    sourceUrl: "https://github.com/x/y",
    title: "x/y",
    version: "v1.0.0",
    discoveredAt: "2026-09-01T00:00:00Z",
    lastSeenAt: "2026-09-21T00:00:00Z",
    summary: "",
    claimedAdvantage: "",
    applicableOwners: ["semantic_retrieval"],
    expectedBenefit: "",
    expectedCost: "",
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    state,
    lastDecision: null,
    lastDecisionReason: "",
    priorRejectionReason: null,
    reevaluationCondition: "",
    cooldownUntil: null,
    evaluations: [
      {
        cycleKey: "weekly-2026-W38",
        evaluatedAt: "2026-09-21T00:00:00Z",
        version: "v1.0.0",
        adapterFingerprint: null,
        architectureFingerprint: "arch-1",
        state,
        decision: "WATCH_NO_EXPERIMENT_ADAPTER",
        reason: "",
        stateTrail: trail,
      },
    ],
    draftPrUrl: null,
    ...overrides,
  };
}

it("lifecycle: only RESEARCHED→SCREENED→(EXPERIMENT_ELIGIBLE→BENCHMARKED→)terminal trails are legal", () => {
  assertValidTrail(["RESEARCHED", "SCREENED", "WATCH"]);
  assertValidTrail(["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", "ACCEPTED"]);
  assert.throws(() => assertValidTrail(["RESEARCHED", "SCREENED", "ACCEPTED"]), /illegal/);
  assert.throws(() => assertValidTrail(["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "ACCEPTED"]), /illegal/);
  assert.throws(() => assertValidTrail(["SCREENED", "WATCH"]), /start at RESEARCHED/);
  assert.throws(() => assertValidTrail(["RESEARCHED", "SCREENED"]), /terminal/);
  assert.equal(canTransition("SCREENED", "ACCEPTED"), false, "ACCEPTED is reachable only from BENCHMARKED");
  assert.equal(canTransition("BENCHMARKED", "ACCEPTED"), true);
});

it("decision codes map to exactly one terminal state", () => {
  assert.equal(decisionState("ACCEPTED_QUALITY_GAIN"), "ACCEPTED");
  assert.equal(decisionState("REJECTED_FALSE_MEMORY_REGRESSION"), "REJECTED");
  assert.equal(decisionState("WATCH_INSUFFICIENT_EVIDENCE"), "WATCH");
  assert.equal(decisionState("WATCH_LIVE_EXPERIMENT_PENDING"), "WATCH");
  assert.equal(decisionState("WATCH_IMPLEMENTATION_PR_PENDING"), "WATCH");
  assert.equal(cooldownUntilFor("REJECTED_NO_QUALITY_GAIN", now), null);
  assert.equal(cooldownUntilFor("WATCH_LIVE_EXPERIMENT_PENDING", now), null);
  assert.equal(cooldownUntilFor("WATCH_IMPLEMENTATION_PR_PENDING", now), null);
  assert.equal(
    cooldownUntilFor("WATCH_NO_EXPERIMENT_ADAPTER", now),
    new Date(now.getTime() + WATCH_COOLDOWN_DAYS * 86_400_000).toISOString()
  );
});

it("dedupe: new candidate evaluates; same version skips; rejected same version never re-experiments", () => {
  const obs = observation({ candidateKey: "github:x/y" });
  assert.deepEqual(decideReevaluation(undefined, obs, ctx), { evaluate: true, trigger: "new_candidate" });
  assert.deepEqual(decideReevaluation(candidate("SCREENED"), obs, ctx), { evaluate: false, skip: "duplicate_same_version" });
  const rejected = candidate("REJECTED", { lastDecision: "REJECTED_INFRA_COMPLEXITY" });
  assert.deepEqual(decideReevaluation(rejected, obs, ctx), { evaluate: false, skip: "rejected_same_version" });
  assert.deepEqual(
    decideReevaluation(rejected, obs, { ...ctx, architectureFingerprint: "arch-2" }),
    { evaluate: false, skip: "rejected_same_version" },
    "screening-rejected candidates ignore benchmark-owner changes"
  );
  assert.deepEqual(
    decideReevaluation(rejected, observation({ candidateKey: "github:x/y", version: null }), ctx),
    { evaluate: false, skip: "rejected_same_version" },
    "an unversioned observation never counts as a new version"
  );
});

it("hook-blocked WATCH candidates re-evaluate on hook-capability architecture change before cooldown", () => {
  const obs = observation({ candidateKey: "github:x/y" });
  const hookBlocked = candidate("WATCH", {
    lastDecision: "WATCH_NO_BENCHMARK_HOOK",
    cooldownUntil: "2026-12-01T00:00:00Z",
    evaluations: [
      {
        cycleKey: "weekly-2026-W38",
        evaluatedAt: "2026-09-21T00:00:00Z",
        version: "v1.0.0",
        adapterFingerprint: null,
        architectureFingerprint: "arch-1",
        state: "WATCH",
        decision: "WATCH_NO_BENCHMARK_HOOK",
        reason: "",
        stateTrail: ["RESEARCHED", "SCREENED", "WATCH"],
      },
    ],
  });

  assert.deepEqual(
    decideReevaluation(hookBlocked, obs, { ...ctx, architectureFingerprint: "arch-2" }),
    { evaluate: true, trigger: "architecture_changed" }
  );

  const noAdapter = candidate("WATCH", {
    lastDecision: "WATCH_NO_EXPERIMENT_ADAPTER",
    cooldownUntil: "2026-12-01T00:00:00Z",
  });
  assert.deepEqual(
    decideReevaluation(noAdapter, obs, { ...ctx, architectureFingerprint: "arch-2" }),
    { evaluate: false, skip: "watch_cooldown" },
    "generic metadata WATCH candidates must not reopen on unrelated architecture changes"
  );
});

it("architecture fingerprint includes the research hook registry owner", () => {
  assert.ok(
    architectureFingerprintPaths().includes("src/lib/memoryResearch/ownerMap.ts"),
    "BENCHMARK_HOOKED_OWNERS changes must affect the architecture fingerprint"
  );
});

it("reevaluation triggers: new release, new adapter evidence, benchmark-owner change, cooldown, deep review, PR retry", () => {
  const rejected = candidate("REJECTED", { lastDecision: "REJECTED_NO_QUALITY_GAIN" });
  assert.deepEqual(
    decideReevaluation(rejected, observation({ candidateKey: "github:x/y", version: "v2.0.0" }), ctx),
    { evaluate: true, trigger: "new_version" }
  );
  assert.deepEqual(
    decideReevaluation(rejected, observation({ candidateKey: "github:x/y" }), { ...ctx, adapterFingerprint: "adapter-1" }),
    { evaluate: true, trigger: "new_evidence" }
  );
  assert.deepEqual(
    decideReevaluation(rejected, observation({ candidateKey: "github:x/y" }), { ...ctx, architectureFingerprint: "arch-2" }),
    { evaluate: true, trigger: "architecture_changed" }
  );
  const watch = candidate("WATCH", { cooldownUntil: "2026-12-01T00:00:00Z" });
  assert.deepEqual(decideReevaluation(watch, observation({ candidateKey: "github:x/y" }), ctx), { evaluate: false, skip: "watch_cooldown" });
  assert.deepEqual(
    decideReevaluation(watch, observation({ candidateKey: "github:x/y" }), { ...ctx, now: new Date("2026-12-02T00:00:00Z") }),
    { evaluate: true, trigger: "cooldown_elapsed" }
  );
  const benchmarkedWatch = candidate("WATCH", {
    cooldownUntil: "2026-12-01T00:00:00Z",
    evaluations: [
      {
        ...watch.evaluations[0]!,
        decision: "WATCH_INSUFFICIENT_EVIDENCE",
        stateTrail: ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", "WATCH"],
      },
    ],
  });
  assert.deepEqual(
    decideReevaluation(benchmarkedWatch, observation({ candidateKey: "github:x/y" }), { ...ctx, deepReview: true }),
    { evaluate: true, trigger: "deep_review" }
  );
  assert.deepEqual(
    decideReevaluation(watch, observation({ candidateKey: "github:x/y" }), { ...ctx, deepReview: true }),
    { evaluate: false, skip: "watch_cooldown" },
    "deep review never re-screens metadata-only WATCH candidates"
  );
  const implementationPending = candidate("WATCH", {
    lastDecision: "WATCH_IMPLEMENTATION_PR_PENDING",
    evaluations: [
      {
        ...watch.evaluations[0]!,
        decision: "WATCH_IMPLEMENTATION_PR_PENDING",
        stateTrail: ["RESEARCHED", "SCREENED", "EXPERIMENT_ELIGIBLE", "BENCHMARKED", "WATCH"],
      },
    ],
  });
  assert.deepEqual(
    decideReevaluation(implementationPending, observation({ candidateKey: "github:x/y" }), { ...ctx, deepReview: true }),
    { evaluate: false, skip: "implementation_pending" },
    "an accepted live experiment is not paid-benchmarked again while implementation is pending"
  );

  const accepted = candidate("ACCEPTED");
  assert.deepEqual(decideReevaluation(accepted, observation({ candidateKey: "github:x/y" }), ctx), { evaluate: true, trigger: "draft_pr_retry" });
  assert.deepEqual(
    decideReevaluation({ ...accepted, draftPrUrl: "https://github.com/o/r/pull/1" }, observation({ candidateKey: "github:x/y" }), ctx),
    { evaluate: false, skip: "accepted_pending_review" },
    "an ACCEPTED candidate with an open Draft PR never opens a duplicate"
  );
});
