import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AUDIT_BASE_USD_KRW,
  AUDIT_EFFECTIVE_KRW_PER_USD,
  BILLING_LIVE_OWNER_MAP,
  CUTOVER_REQUIRED_MODEL_FAMILIES,
  DEEPSEEK_PHASE2,
  DEFERRED_BILLING_MODELS,
  F4_CLASSIFICATION,
  FROZEN_LIVE_CHARGE_GOLDEN,
  INTERNAL_DELIVERED_PRODUCTION_OWNERS,
  OPENROUTER_G31_CURRENTLY_DELIVERABLE,
  OPUS45_ADMIN_SPECIAL_CASE,
  PHASE_1_CUTOVER_REQUIRED_MODELS,
  PHASE_1_CUTOVER_REQUIRED_MODEL_FAMILIES,
  PHASE_2_PLANNED_MODELS,
  REGEN_USER_CHARGE_SCOPE,
  SPECIAL_BILLING_POLICIES,
  auditCanaryCleanupClassification,
  auditF4RequestedDeliveredIdentity,
  auditFalseExactnessGuards,
  auditNonPhase1ModelExposure,
  buildBillingLiveOwnerReadinessFixtures,
  buildCurrentReachableBilledModelInventory,
  buildSpecialPolicyCoverageMatrix,
  collectBillingReadinessHardGates,
  collectExactDeliveredModelCoverage,
  collectPhase1ExactDeliveredModelCoverage,
  compareLiveVsCandidate,
  computeCandidateChargeFromFixture,
  computeLiveChargeFromFixture,
  derivePolicyCoverageCounts,
  derivePolicyReportFacts,
  evaluateBillingLiveOwnerReadiness,
  generateBillingLiveOwnerReadinessFinalReport,
  getAuditFxParityEvidence,
  getAuditFxScopeDepthForTest,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  probeAuditFxNestedScopeSafety,
  isTurnBillableUsageCanaryLiveInSource,
  verifyBaseVsHeadLiveParity,
  verifyPlatformFundedAuxIsolation,
} from "./billingLiveOwnerReadinessAudit";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import { serializeUsageForPublicClient } from "@/lib/billingReceiptAccess";
import { assertNoInternalEconomics } from "@/lib/publicUsageEconomicsBoundary";
import type { Usage } from "@/lib/chatUsage";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const PRODUCTION_BILLING_PATH_PREFIXES = [
  "src/app/api/chat/route.ts",
  "src/lib/points.ts",
  "src/lib/pointsReasoningMargins.ts",
  "src/lib/pointsMuse60.ts",
  "src/lib/chatBillingSettlement.ts",
  "src/lib/publishedUserCharge.ts",
  "src/lib/exchangeRate.ts",
  "src/lib/billingFxPolicy.ts",
];

const FORBIDDEN_AUDIT_IMPORTS = [
  "deductPoints",
  "settleChatTurnBillingExactlyOnce",
  "computeShadowPricing",
  "observeTurnBillableUsageCanary",
] as const;

describe("billingLiveOwnerReadinessAudit — production boundary", () => {
  it("audit module has no live deduction or settlement imports", () => {
    const src = readFileSync(join(REPO_ROOT, "src/lib/billingLiveOwnerReadinessAudit.ts"), "utf8");
    const importLines = src.split("\n").filter((line) => line.trimStart().startsWith("import "));
    for (const forbidden of FORBIDDEN_AUDIT_IMPORTS) {
      assert.ok(importLines.every((line) => !line.includes(forbidden)), forbidden);
    }
    assert.ok(!src.includes("auditInternalAsyncRecordReaders"));
    assert.ok(!src.includes("from \"@/app/api/chat/route\""));
  });

  it("route.ts and settlement do not import audit harness", () => {
    const routeSrc = readFileSync(join(REPO_ROOT, "src/app/api/chat/route.ts"), "utf8");
    const settlementSrc = readFileSync(join(REPO_ROOT, "src/lib/chatBillingSettlement.ts"), "utf8");
    assert.ok(!routeSrc.includes("billingLiveOwnerReadinessAudit"));
    assert.ok(!settlementSrc.includes("billingLiveOwnerReadinessAudit"));
  });

  it("PRODUCTION_BILLING_FILES_CHANGED_BY_PR795=0", () => {
    let diff: string;
    try {
      diff = execSync("git diff --name-only origin/main...HEAD", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    } catch {
      diff = execSync("git diff --name-only HEAD~1...HEAD", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    }
    const changed = diff
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const productionBillingChanged = changed.filter((file) =>
      PRODUCTION_BILLING_PATH_PREFIXES.includes(file)
    );
    assert.deepEqual(productionBillingChanged, [], JSON.stringify(productionBillingChanged));
  });
});

describe("billingLiveOwnerReadinessAudit — owner map", () => {
  it("declares main RP vs HTML flash live charge owners", () => {
    assert.ok(BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER.includes("computeTurnBilling"));
    assert.ok(
      BILLING_LIVE_OWNER_MAP.HTML_FLASH_ONLY_LIVE_USER_CHARGE_OWNER.includes(
        "computeHtmlFlashOnlyTurnBilling"
      )
    );
    assert.equal(BILLING_LIVE_OWNER_MAP.CUTOVER_SCOPE, "MAIN_RP_ONLY");
    assert.equal(BILLING_LIVE_OWNER_MAP.HTML_FLASH_ONLY_CUTOVER_SCOPE, "KEEP_SEPARATE");
  });

  it("CURRENT_REACHABLE_MODEL_WITHOUT_CLASSIFICATION=0", () => {
    const inventory = buildCurrentReachableBilledModelInventory();
    assert.ok(inventory.length > 0);
    for (const entry of inventory) {
      assert.ok(entry.classification);
      assert.ok(entry.reachabilityOwner);
      assert.ok(entry.deliveredModelId);
      assert.equal(entry.modelId, entry.deliveredModelId);
      assert.ok(typeof entry.cutoverRequired === "boolean");
    }
  });

  it("PHASE1_EXACT_MODEL_WITHOUT_FIXTURE=0 for Phase 1 cutover models only", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const phase1 = collectPhase1ExactDeliveredModelCoverage(fixtures);
    assert.equal(phase1.uncoveredPhase1Required.length, 0);
    for (const modelId of PHASE_1_CUTOVER_REQUIRED_MODEL_FAMILIES) {
      assert.ok(
        phase1.a1ExactDeliveredModelIds.has(modelId),
        `missing exact A1 fixture for ${modelId}`
      );
    }
  });

  it("Phase 1 scope is separate from full reachable inventory", () => {
    assert.deepEqual(PHASE_1_CUTOVER_REQUIRED_MODELS, [
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    ]);
    assert.deepEqual(PHASE_2_PLANNED_MODELS, [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]);
    assert.equal(DEEPSEEK_PHASE2, true);
    assert.ok(DEFERRED_BILLING_MODELS.length > 0);
    assert.ok(CUTOVER_REQUIRED_MODEL_FAMILIES.length > PHASE_1_CUTOVER_REQUIRED_MODEL_FAMILIES.length);
    const full = collectExactDeliveredModelCoverage(buildBillingLiveOwnerReadinessFixtures());
    assert.notDeepEqual(
      [...CUTOVER_REQUIRED_MODEL_FAMILIES].sort(),
      [...PHASE_1_CUTOVER_REQUIRED_MODEL_FAMILIES].sort()
    );
    assert.equal(full.phase1.uncoveredPhase1Required.length, 0);
  });

  it("reports non-Phase-1 user exposure separately from promotion gates", () => {
    const exposure = auditNonPhase1ModelExposure();
    assert.ok(exposure.nonPhase1UserSelectableModels.length > 0);
    assert.ok(exposure.nonPhase1StoredSelectionStillExecutable.length > 0);
    assert.equal(exposure.nonPhase1UserBillingPolicy, "EXPLICIT_LEGACY_DEFERRED");
    assert.equal(exposure.recommendedNonPhase1UserBillingPolicy, "DISABLED_FOR_NEW_USE");
    assert.ok(!exposure.nonPhase1UserSelectableModels.includes(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL));
  });

  it("does not treat OPENROUTER_G31 as live-delivered without production call site", () => {
    assert.equal(OPENROUTER_G31_CURRENTLY_DELIVERABLE, false);
    const inventory = buildCurrentReachableBilledModelInventory();
    assert.ok(
      !inventory.some(
        (entry) =>
          entry.deliveredModelId === "google/gemini-3.1-pro-preview" &&
          entry.classification === "INTERNAL_DELIVERED"
      )
    );
    const legacy = inventory.find((entry) => entry.deliveredModelId === "google/gemini-3.1-pro-preview");
    assert.ok(legacy);
    assert.equal(legacy.classification, "LEGACY_COMPAT_ONLY");
  });

  it("Opus 4.5 is not ADMIN_REACHABLE without admin-only route", () => {
    assert.equal(OPUS45_ADMIN_SPECIAL_CASE, false);
    const inventory = buildCurrentReachableBilledModelInventory();
    const opus45 = inventory.find((entry) => entry.deliveredModelId.includes("claude-opus-4"));
    assert.ok(opus45);
    assert.notEqual(opus45.classification, "ADMIN_REACHABLE");
  });

  it("Opus 5 hidden flag uses CONDITIONAL_REACHABLE not ADMIN_REACHABLE", () => {
    const inventory = buildCurrentReachableBilledModelInventory();
    const opus5 = inventory.find((entry) => entry.deliveredModelId === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.ok(opus5);
    if (process.env.OPUS5_USER_ENABLED?.trim() !== "1") {
      assert.equal(opus5.classification, "CONDITIONAL_REACHABLE");
    }
  });

  it("INTERNAL_DELIVERED models have production owner evidence", () => {
    assert.ok(INTERNAL_DELIVERED_PRODUCTION_OWNERS.length > 0);
    for (const evidence of INTERNAL_DELIVERED_PRODUCTION_OWNERS) {
      assert.ok(evidence.productionRoutingOwner);
      assert.ok(evidence.actualCallSite);
      assert.ok(evidence.trigger);
    }
  });

  it("LEGACY slugs are not counted as cutover-required without proof", () => {
    const inventory = buildCurrentReachableBilledModelInventory();
    const legacy = inventory.filter((e) => e.classification === "LEGACY_COMPAT_ONLY");
    assert.ok(legacy.some((e) => e.deliveredModelId.includes("qwen")));
    assert.ok(legacy.every((e) => e.cutoverRequired === false));
  });

  it("TurnBillableUsage production canary is live in route.ts source", () => {
    assert.equal(isTurnBillableUsageCanaryLiveInSource(), true);
  });

  it("REGEN_USER_CHARGE_SCOPE=REQUEST_LOCAL (no fake regen fixture)", () => {
    assert.equal(REGEN_USER_CHARGE_SCOPE, "REQUEST_LOCAL");
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    assert.ok(!fixtures.some((f) => f.id.startsWith("G1-")));
  });
});

describe("billingLiveOwnerReadinessAudit — FX parity", () => {
  const previousMode = process.env.EXCHANGE_RATE_MODE;

  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  it("PATH_A_PATH_B_SAME_FX under frozen legacy cache", () => {
    assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
    assert.equal(AUDIT_EFFECTIVE_KRW_PER_USD, applyOverseasCardFee(AUDIT_BASE_USD_KRW));
    const evidence = getAuditFxParityEvidence();
    assert.equal(evidence.live.baseUsdKrw, AUDIT_BASE_USD_KRW);
    assert.equal(evidence.candidate.usdToKrw, AUDIT_BASE_USD_KRW);
    assert.equal(evidence.live.effectiveKrwPerUsd, evidence.candidate.effectiveKrwPerUsd);
  });

  it("AUDIT_FX_ENV_LEAK=false restores EXCHANGE_RATE_MODE", () => {
    assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
    clearAuditLegacyFxForTest();
    if (previousMode === undefined) {
      assert.equal(process.env.EXCHANGE_RATE_MODE, undefined);
    } else {
      assert.equal(process.env.EXCHANGE_RATE_MODE, previousMode);
    }
    installAuditLegacyFxForTest();
  });
});

describe("billingLiveOwnerReadinessAudit — FX nested scope (FX-N1..N4)", () => {
  it("FX-N1 — original undefined: nested install/clear restores undefined", () => {
    const saved = process.env.EXCHANGE_RATE_MODE;
    try {
      delete process.env.EXCHANGE_RATE_MODE;
      installAuditLegacyFxForTest();
      installAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, undefined);
      assert.equal(getAuditFxScopeDepthForTest(), 0);
    } finally {
      if (saved === undefined) {
        delete process.env.EXCHANGE_RATE_MODE;
      } else {
        process.env.EXCHANGE_RATE_MODE = saved;
      }
    }
  });

  it("FX-N2 — original realtime: nested install/clear restores realtime", () => {
    const saved = process.env.EXCHANGE_RATE_MODE;
    try {
      process.env.EXCHANGE_RATE_MODE = "realtime";
      installAuditLegacyFxForTest();
      installAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "realtime");
      assert.equal(getAuditFxScopeDepthForTest(), 0);
    } finally {
      if (saved === undefined) {
        delete process.env.EXCHANGE_RATE_MODE;
      } else {
        process.env.EXCHANGE_RATE_MODE = saved;
      }
    }
  });

  it("FX-N3 — nested evaluator keeps audit FX until outer clear", () => {
    const saved = process.env.EXCHANGE_RATE_MODE;
    try {
      process.env.EXCHANGE_RATE_MODE = "realtime";
      installAuditLegacyFxForTest();
      evaluateBillingLiveOwnerReadiness();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getEffectiveKrwPerUsd(), AUDIT_EFFECTIVE_KRW_PER_USD);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "realtime");
      assert.equal(getAuditFxScopeDepthForTest(), 0);
    } finally {
      if (saved === undefined) {
        delete process.env.EXCHANGE_RATE_MODE;
      } else {
        process.env.EXCHANGE_RATE_MODE = saved;
      }
    }
  });

  it("FX-N4 — sequential scopes leave no state drift", () => {
    const saved = process.env.EXCHANGE_RATE_MODE;
    try {
      delete process.env.EXCHANGE_RATE_MODE;
      installAuditLegacyFxForTest();
      clearAuditLegacyFxForTest();
      installAuditLegacyFxForTest();
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, undefined);
      assert.equal(getAuditFxScopeDepthForTest(), 0);
    } finally {
      if (saved === undefined) {
        delete process.env.EXCHANGE_RATE_MODE;
      } else {
        process.env.EXCHANGE_RATE_MODE = saved;
      }
    }
  });

  it("probe preserves outer FX scope original env provenance", () => {
    const saved = process.env.EXCHANGE_RATE_MODE;
    try {
      process.env.EXCHANGE_RATE_MODE = "realtime";
      installAuditLegacyFxForTest();
      const probe = probeAuditFxNestedScopeSafety();
      assert.equal(probe.nestedScopeSafe, true);
      assert.equal(process.env.EXCHANGE_RATE_MODE, "daily_kst");
      assert.equal(getAuditFxScopeDepthForTest(), 1);
      clearAuditLegacyFxForTest();
      assert.equal(process.env.EXCHANGE_RATE_MODE, "realtime");
    } finally {
      if (saved === undefined) {
        delete process.env.EXCHANGE_RATE_MODE;
      } else {
        process.env.EXCHANGE_RATE_MODE = saved;
      }
    }
  });
});

describe("billingLiveOwnerReadinessAudit — BASE vs HEAD live parity gate", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  const fixtures = buildBillingLiveOwnerReadinessFixtures();

  it("BASE_VS_HEAD_LIVE_MISMATCH_COUNT=0 for frozen golden fixtures", () => {
    assert.ok(Object.keys(FROZEN_LIVE_CHARGE_GOLDEN).length > 0);
    const { mismatchCount, mismatches } = verifyBaseVsHeadLiveParity(fixtures);
    assert.equal(mismatchCount, 0, JSON.stringify(mismatches));
  });

  it("every golden fixture id exists in fixture builder", () => {
    const ids = new Set(fixtures.map((f) => f.id));
    for (const id of Object.keys(FROZEN_LIVE_CHARGE_GOLDEN)) {
      assert.ok(ids.has(id), `missing fixture ${id}`);
    }
  });
});

describe("billingLiveOwnerReadinessAudit — policy coverage matrix", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  it("Phase 1 policies require behavioral proof not fixture existence only", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const matrix = buildSpecialPolicyCoverageMatrix(fixtures);
    const phase1Rows = matrix.filter((row) => row.classification === "PHASE1_REQUIRED");
    for (const row of phase1Rows) {
      assert.ok(row.fixtureIds.length > 0, row.policy);
      assert.ok(Object.keys(row.proof).length > 0, row.policy);
      assert.equal(row.covered, row.fixturesExist && row.behavioralProofPasses, row.policy);
    }
    const counts = derivePolicyCoverageCounts(matrix);
    assert.equal(
      counts.uncoveredPhase1PolicyCount,
      0,
      JSON.stringify(phase1Rows.filter((row) => !row.covered))
    );
  });

  it("deferred model policies are not Phase 1 blockers", () => {
    const matrix = buildSpecialPolicyCoverageMatrix(buildBillingLiveOwnerReadinessFixtures());
    const deferred = matrix.filter((row) => row.classification === "DEFERRED_NOT_PHASE1_BLOCKER");
    assert.ok(deferred.some((row) => row.policy.includes("savedTextChars")));
    assert.ok(deferred.some((row) => row.policy.includes("stealth fallback")));
    const counts = derivePolicyCoverageCounts(matrix);
    assert.ok(counts.deferredNotPhase1BlockerCount >= 2);
  });

  it("Phase 1 waiver evidence covers G31/G37/Opus5 without DeepSeek/G36 matrix", () => {
    const matrix = buildSpecialPolicyCoverageMatrix(buildBillingLiveOwnerReadinessFixtures());
    const waiver = matrix.find((row) => row.policy.includes("waiver minimum"));
    assert.ok(waiver);
    assert.equal(waiver.classification, "PHASE1_REQUIRED");
    assert.equal(waiver.covered, true);
    assert.equal(Number(waiver.proof.phase1WaiverModelWithoutEvidence), 0);
    assert.equal(waiver.proof.g37NoModelSpecificMinimum, 1);
    assert.equal(waiver.proof.opus5NoModelSpecificMinimum, 1);
    assert.equal(waiver.proof.g31HasModelSpecificMinimumResolver, 1);
  });

  it("unified-reasoning and G37 proofs use canonical owners not cross-model diffs", () => {
    const matrix = buildSpecialPolicyCoverageMatrix(buildBillingLiveOwnerReadinessFixtures());
    const unified = matrix.find((row) => row.policy === "unified-reasoning margins (G31 CI, Opus5)");
    const g37 = matrix.find((row) => row.policy === "gemini37FlashPricing dedicated formula");
    assert.ok(unified);
    assert.ok(g37);
    assert.equal(unified.behavioralProofPasses, true);
    assert.equal(g37.behavioralProofPasses, true);
    assert.equal(unified.proof.g31ExpectedPoints, unified.proof.g31LivePoints);
    assert.equal(unified.proof.opusExpectedPoints, unified.proof.opusLivePoints);
    assert.equal(g37.proof.g37CanonicalExpectedPoints, g37.proof.liveG37Points);
  });

  it("output-token pricing proves API vs saved-text fallback precedence", () => {
    const matrix = buildSpecialPolicyCoverageMatrix(buildBillingLiveOwnerReadinessFixtures());
    const outputToken = matrix.find(
      (row) => row.policy === "output-token pricing (api vs savedText fallback)"
    );
    assert.ok(outputToken);
    assert.equal(outputToken.behavioralProofPasses, true);
    assert.equal(outputToken.proof.ot1ApiCompletionTokens, 500);
    assert.equal(outputToken.proof.ot2LiveBillingCompletionSource, "SAVED_TEXT_FALLBACK");
  });

  it("SPECIAL_BILLING_POLICIES derived from matrix", () => {
    assert.ok(SPECIAL_BILLING_POLICIES.length >= 10);
    assert.equal(SPECIAL_BILLING_POLICIES.length, derivePolicyCoverageCounts().totalPolicyCount);
  });
});

describe("billingLiveOwnerReadinessAudit — golden parity harness", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  const fixtures = buildBillingLiveOwnerReadinessFixtures();

  it("Path A and Path B are independently computed", () => {
    const fixture = fixtures.find((f) => f.id === "B3-cache-valid-positive")!;
    const live = computeLiveChargeFromFixture(fixture);
    const candidate = computeCandidateChargeFromFixture(fixture);
    assert.ok(live.totalPoints > 0);
    assert.equal(candidate.status, "charged");
    if (candidate.status === "charged") {
      assert.notEqual(live.totalPoints, candidate.finalPoints);
    }
  });

  it("evaluateBillingLiveOwnerReadiness counts blockers (not only mismatch)", () => {
    const evaluation = evaluateBillingLiveOwnerReadiness(
      fixtures.filter((f) => f.id !== "P1-platform-aux-isolation-with-aux-stage")
    );
    assert.equal(evaluation.promotionReady, false);
    assert.ok(evaluation.blockedCount > 0 || evaluation.notComparableCount > 0);
    assert.equal(evaluation.uncoveredModelCount, 0);
    assert.equal(evaluation.uncoveredPolicyCount, 0);
  });

  it("waiver fixtures use canonical owners (no shortcut field)", () => {
    for (const id of [
      "W1-degeneration-waiver",
      "W2-forced-abort-minimum-zero",
      "W3-generation-failure-waiver",
      "W4-no-waiver-minimum-model",
    ]) {
      const fixture = fixtures.find((f) => f.id === id)!;
      assert.equal(computeLiveChargeFromFixture(fixture).totalPoints, 0, id);
    }
  });

  it("hard gates separate audit coverage from cutover readiness", () => {
    const gates = collectBillingReadinessHardGates(fixtures);
    const evaluation = evaluateBillingLiveOwnerReadiness(
      fixtures.filter((f) => f.id !== "P1-platform-aux-isolation-with-aux-stage")
    );
    assert.equal(gates.PHASE1_EXACT_MODEL_WITHOUT_FIXTURE, 0);
    assert.equal(gates.PHASE1_UNCOVERED_POLICY_COUNT, 0);
    assert.equal(gates.PHASE1_WAIVER_MODEL_WITHOUT_EVIDENCE, 0);
    assert.equal(gates.PHASE1_AUDIT_COVERAGE_COMPLETE, true);
    assert.ok(Number(gates.PHASE1_PARITY_BLOCKER_COUNT) > 0);
    assert.equal(gates.PHASE1_CUTOVER_READY, false);
    assert.equal(evaluation.promotionReady, false);
    assert.equal(gates.DEEPSEEK_PHASE2, true);
  });
});

describe("billingLiveOwnerReadinessAudit — F4 model handoff", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  it("bills delivered model identity, not requested", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "F4-model-handoff")!;
    assert.notEqual(fixture.requestedSelectedAI, fixture.deliveredSelectedAI);
    assert.notEqual(fixture.requestedSelectedAI, fixture.deliveredModelId);
    const identity = auditF4RequestedDeliveredIdentity();
    assert.equal(identity.classification, F4_CLASSIFICATION);
    assert.notEqual(identity.requestedModel, identity.deliveredModel);
    assert.equal(identity.liveBillingModel, identity.deliveredModel);
    assert.equal(identity.candidateBillingModel, identity.deliveredModel);
    assert.equal(identity.requestedModelUsedForPrice, false);
    const live = computeLiveChargeFromFixture(fixture);
    assert.equal(live.modelId, fixture.deliveredModelId);
    const candidate = computeCandidateChargeFromFixture(fixture);
    assert.equal(candidate.billingModelId, fixture.deliveredModelId);
  });
});

describe("billingLiveOwnerReadinessAudit — false exactness guards", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  it("unreported/invalid provenance must not become exact complete charge", () => {
    const audit = auditFalseExactnessGuards();
    assert.equal(audit.unreportedCacheCanBecomeConfirmedZero, false);
    assert.equal(audit.invalidCacheCanBecomeExact, false);
    assert.equal(audit.unreportedReasoningCanBecomeConfirmedZero, false);
    assert.equal(audit.invalidReasoningCanBecomeExact, false);
    assert.equal(audit.mixedValidInvalidStageCanBecomeExact, false);
  });
});

describe("billingLiveOwnerReadinessAudit — platform-funded aux isolation", () => {
  beforeEach(() => {
    installAuditLegacyFxForTest();
  });

  afterEach(() => {
    clearAuditLegacyFxForTest();
  });

  it("PLATFORM_FUNDED_AUX_CHANGES_USER_CHARGE=false (synthetic stress fixture)", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const result = verifyPlatformFundedAuxIsolation(fixtures);
    assert.equal(result.auxChangesUserCharge, false);
    assert.ok(result.note.toLowerCase().includes("synthetic"));
  });
});

describe("billingLiveOwnerReadinessAudit — canary cleanup audit", () => {
  it("classifies #732/#739 symbols without deleting production canary", () => {
    const entries = auditCanaryCleanupClassification();
    assert.ok(entries.some((e) => e.symbol === "observeTurnBillableUsageCanary" && e.classification === "KEEP"));
  });
});

describe("billingLiveOwnerReadinessAudit — public economics privacy", () => {
  it("audit Usage fixture does not leak internal economics via serializeUsageForPublicClient", () => {
    const usage: Usage = {
      input: 100,
      output: 200,
      model: "claude-opus-5",
      cost: 42,
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 5,
        billingReferenceOutputUsdPerMillion: 25,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: {
          dateKey: "2026-08-28",
          source: "api_daily",
          baseUsdKrw: 1530,
          overseasFeeRate: 0.02,
          effectiveKrwPerUsd: 1560.6,
        },
        providerListCostStatus: "complete",
      },
    };
    const pub = serializeUsageForPublicClient(usage);
    assertNoInternalEconomics(pub as Record<string, unknown>);
  });
});

describe("billingLiveOwnerReadinessAudit — final report", () => {
  it("generateBillingLiveOwnerReadinessFinalReport ends with STOP", () => {
    const report = generateBillingLiveOwnerReadinessFinalReport();
    assert.ok(report.includes("=== PHASE 1 PUBLISHED BILLING SCOPE ==="));
    assert.ok(report.includes(`PHASE1_PUBLISHED_BILLING_MODELS=${PHASE_1_CUTOVER_REQUIRED_MODELS.join(",")}`));
    assert.ok(report.includes("PHASE1_AUDIT_COVERAGE_COMPLETE=YES"));
    assert.ok(report.includes("PHASE1_CUTOVER_READY=NO"));
    assert.ok(report.includes("DEEPSEEK_FALLBACK_AFFECTS_PHASE1_CUTOVER_READY=false"));
    assert.ok(report.includes("NON_PHASE1_USER_SELECTABLE_MODELS="));
    assert.ok(report.endsWith("STOP"));
  });
});
