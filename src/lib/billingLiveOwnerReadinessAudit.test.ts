import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AUDIT_BASE_USD_KRW,
  AUDIT_EFFECTIVE_KRW_PER_USD,
  BILLING_LIVE_OWNER_MAP,
  COMPLETED_TURN_RUNTIME_EFFECT,
  CUTOVER_REQUIRED_MODEL_FAMILIES,
  F4_CLASSIFICATION,
  FROZEN_LIVE_CHARGE_GOLDEN,
  INTERNAL_DELIVERED_PRODUCTION_OWNERS,
  OPENROUTER_G31_CURRENTLY_DELIVERABLE,
  OPUS45_ADMIN_SPECIAL_CASE,
  REGEN_USER_CHARGE_SCOPE,
  SPECIAL_BILLING_POLICIES,
  UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G36,
  WAIVER_MINIMUM_RUNTIME_REACHABLE,
  auditCanaryCleanupClassification,
  auditF4RequestedDeliveredIdentity,
  auditFalseExactnessGuards,
  buildBillingLiveOwnerReadinessFixtures,
  buildCurrentReachableBilledModelInventory,
  buildSpecialPolicyCoverageMatrix,
  collectBillingReadinessHardGates,
  collectExactDeliveredModelCoverage,
  compareLiveVsCandidate,
  computeCandidateChargeFromFixture,
  computeLiveChargeFromFixture,
  derivePolicyCoverageCounts,
  evaluateBillingLiveOwnerReadiness,
  generateBillingLiveOwnerReadinessFinalReport,
  getAuditFxParityEvidence,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  isTurnBillableUsageCanaryLiveInSource,
  verifyBaseVsHeadLiveParity,
  verifyPlatformFundedAuxIsolation,
} from "./billingLiveOwnerReadinessAudit";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import { CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL } from "@/lib/chatModels";
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

  it("CUTOVER_REQUIRED_EXACT_DELIVERED_MODEL_WITHOUT_FIXTURE=0", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const { a1ExactDeliveredModelIds, uncoveredCutoverRequired } =
      collectExactDeliveredModelCoverage(fixtures);
    assert.equal(uncoveredCutoverRequired.length, 0);
    for (const modelId of CUTOVER_REQUIRED_MODEL_FAMILIES) {
      assert.ok(
        a1ExactDeliveredModelIds.has(modelId),
        `missing exact A1 fixture for ${modelId}`
      );
    }
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

  it("LIVE policies require behavioral proof not fixture existence only", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const matrix = buildSpecialPolicyCoverageMatrix(fixtures);
    const liveRows = matrix.filter((row) => row.classification === "LIVE_REACHABLE");
    for (const row of liveRows) {
      assert.ok(row.fixtureIds.length > 0, row.policy);
      assert.ok(Object.keys(row.proof).length > 0, row.policy);
    }
    const counts = derivePolicyCoverageCounts(matrix);
    assert.equal(
      counts.uncoveredLivePolicyCount,
      0,
      JSON.stringify(liveRows.filter((row) => !row.covered))
    );
  });

  it("dead policies are classified without cutover-required coverage debt", () => {
    assert.equal(WAIVER_MINIMUM_RUNTIME_REACHABLE, false);
    assert.equal(COMPLETED_TURN_RUNTIME_EFFECT, "NO_LIVE_EFFECT");
    assert.equal(UPSTREAM_COST_CONSUMED_BY_LIVE_OWNER_G36, false);
    const matrix = buildSpecialPolicyCoverageMatrix(buildBillingLiveOwnerReadinessFixtures());
    const waiver = matrix.find((row) => row.policy.includes("waiver minimum"));
    assert.ok(waiver);
    assert.equal(waiver.classification, "LEGACY_OR_DEAD");
    assert.equal(waiver.covered, true);
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

  it("hard gates include exact delivered-model coverage flags", () => {
    const gates = collectBillingReadinessHardGates(fixtures);
    assert.equal(gates.CUTOVER_REQUIRED_EXACT_DELIVERED_MODEL_WITHOUT_FIXTURE, 0);
    assert.equal(gates.DELIVERED_MODEL_COVERAGE_USING_SELECTION_REMAP, false);
    assert.equal(gates.POLICY_COVERAGE_BY_FIXTURE_EXISTENCE_ONLY, false);
    assert.equal(gates.UNCOVERED_LIVE_POLICY_COUNT, 0);
    assert.equal(gates.F4_REQUESTED_DELIVERED_IDENTITY_PROVEN, true);
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
    assert.ok(report.includes("=== EXACT MODEL COVERAGE ==="));
    assert.ok(report.includes("DELIVERED_MODEL_COVERAGE_USING_SELECTION_REMAP=false"));
    assert.ok(report.endsWith("STOP"));
  });
});
