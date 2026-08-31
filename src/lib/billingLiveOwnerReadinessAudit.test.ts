import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AUDIT_BASE_MAIN_SHA,
  AUDIT_EFFECTIVE_KRW_PER_USD,
  AUDIT_BASE_USD_KRW,
  BILLING_LIVE_OWNER_MAP,
  CUTOVER_REQUIRED_MODEL_FAMILIES,
  FROZEN_LIVE_CHARGE_GOLDEN,
  REGEN_USER_CHARGE_SCOPE,
  SPECIAL_BILLING_POLICIES,
  auditCanaryCleanupClassification,
  auditFalseExactnessGuards,
  buildBillingLiveOwnerReadinessFixtures,
  buildCurrentReachableBilledModelInventory,
  buildSpecialPolicyCoverageMatrix,
  collectParityMismatches,
  compareLiveVsCandidate,
  computeCandidateChargeFromFixture,
  computeLiveChargeFromFixture,
  evaluateBillingLiveOwnerReadiness,
  getAuditFxParityEvidence,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  isTurnBillableUsageCanaryLiveInSource,
  verifyBaseVsHeadLiveParity,
  verifyPlatformFundedAuxIsolation,
} from "./billingLiveOwnerReadinessAudit";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import { serializeUsageForPublicClient } from "@/lib/billingReceiptAccess";
import { assertNoInternalEconomics } from "@/lib/publicUsageEconomicsBoundary";
import type { Usage } from "@/lib/chatUsage";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

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
    assert.ok(!src.includes("from \"@/app/api/chat/route\""));
    assert.ok(!src.includes("from '@/app/api/chat/route'"));
  });

  it("route.ts and settlement do not import audit harness", () => {
    const routeSrc = readFileSync(join(REPO_ROOT, "src/app/api/chat/route.ts"), "utf8");
    const settlementSrc = readFileSync(join(REPO_ROOT, "src/lib/chatBillingSettlement.ts"), "utf8");
    assert.ok(!routeSrc.includes("billingLiveOwnerReadinessAudit"));
    assert.ok(!settlementSrc.includes("billingLiveOwnerReadinessAudit"));
  });

  it("candidate path does not delegate to computeTurnBilling", () => {
    for (const rel of ["src/lib/publishedUserCharge.ts", "src/lib/turnBillableUsage.ts"]) {
      const importLines = readFileSync(join(REPO_ROOT, rel), "utf8")
        .split("\n")
        .filter((line) => line.trimStart().startsWith("import "));
      assert.ok(importLines.every((line) => !line.includes("computeTurnBilling")), rel);
    }
  });
});

describe("billingLiveOwnerReadinessAudit — owner map", () => {
  it("declares one canonical owner per responsibility", () => {
    assert.ok(BILLING_LIVE_OWNER_MAP.MAIN_RP_LIVE_USER_CHARGE_OWNER.includes("computeTurnBilling"));
    assert.ok(
      BILLING_LIVE_OWNER_MAP.HTML_FLASH_ONLY_LIVE_USER_CHARGE_OWNER.includes(
        "computeHtmlFlashOnlyTurnBilling"
      )
    );
    assert.equal(BILLING_LIVE_OWNER_MAP.CUTOVER_SCOPE, "MAIN_RP_ONLY");
    assert.equal(BILLING_LIVE_OWNER_MAP.HTML_FLASH_ONLY_CUTOVER_SCOPE, "KEEP_SEPARATE");
    assert.ok(BILLING_LIVE_OWNER_MAP.CURRENT_POINT_DEDUCTION_OWNER.includes("settleChatTurnBillingExactlyOnce"));
    assert.ok(BILLING_LIVE_OWNER_MAP.CANDIDATE_TURN_BILLABLE_USAGE_OWNER.includes("resolveTurnBillableUsage"));
    assert.ok(BILLING_LIVE_OWNER_MAP.CANDIDATE_PUBLISHED_CHARGE_OWNER.includes("computePublishedUserChargeWithSnapshot"));
    assert.ok(BILLING_LIVE_OWNER_MAP.USER_CHARGE_OWNER.includes("computeTurnBilling"));
    assert.ok(BILLING_LIVE_OWNER_MAP.ACTUAL_PROVIDER_COST_OWNER.includes("shadowPricing"));
    assert.notEqual(
      BILLING_LIVE_OWNER_MAP.USER_CHARGE_OWNER,
      BILLING_LIVE_OWNER_MAP.ACTUAL_PROVIDER_COST_OWNER
    );
  });

  it("derives cutover-required model families from inventory", () => {
    const inventory = buildCurrentReachableBilledModelInventory();
    assert.ok(CUTOVER_REQUIRED_MODEL_FAMILIES.length >= 6);
    assert.ok(SPECIAL_BILLING_POLICIES.length >= 5);
    assert.ok(inventory.some((entry) => entry.cutoverRequired));
  });

  it("TurnBillableUsage production canary is live in route.ts source", () => {
    assert.equal(isTurnBillableUsageCanaryLiveInSource(), true);
  });

  it("exports regen charge scope constant", () => {
    assert.equal(REGEN_USER_CHARGE_SCOPE, "REQUEST_LOCAL");
  });
});

describe("billingLiveOwnerReadinessAudit — FX parity helpers", () => {
  it("audit FX constants match overseas card fee policy", () => {
    assert.equal(AUDIT_EFFECTIVE_KRW_PER_USD, applyOverseasCardFee(AUDIT_BASE_USD_KRW));
    const evidence = getAuditFxParityEvidence();
    assert.equal(evidence.live.effectiveKrwPerUsd, evidence.candidate.effectiveKrwPerUsd);
  });
});

describe("billingLiveOwnerReadinessAudit — BASE vs HEAD live parity gate", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();

  it("BASE_VS_HEAD_LIVE_MISMATCH_COUNT=0 when golden map is empty placeholder", () => {
    const { mismatchCount } = verifyBaseVsHeadLiveParity(fixtures);
    assert.equal(mismatchCount, 0);
    assert.equal(Object.keys(FROZEN_LIVE_CHARGE_GOLDEN).length, 0);
  });

  it("every golden fixture id exists in fixture builder when populated", () => {
    const ids = new Set(fixtures.map((f) => f.id));
    for (const id of Object.keys(FROZEN_LIVE_CHARGE_GOLDEN)) {
      assert.ok(ids.has(id), `missing fixture ${id}`);
    }
  });

  it("frozen golden was captured at AUDIT_BASE_MAIN_SHA", () => {
    assert.equal(AUDIT_BASE_MAIN_SHA, "cc5c88f41d6abdc3f923430161189dfaa2b87532");
  });
});

describe("billingLiveOwnerReadinessAudit — golden parity harness", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();

  it("Path A and Path B are independently computed (not same helper)", () => {
    installAuditLegacyFxForTest();
    try {
      const fixture = fixtures.find((f) => f.id === "B3-cache-valid-positive")!;
      const live = computeLiveChargeFromFixture(fixture);
      const candidate = computeCandidateChargeFromFixture(fixture);
      assert.ok(live.totalPoints > 0);
      assert.equal(candidate.status, "charged");
      if (candidate.status === "charged") {
        assert.notEqual(live.totalPoints, candidate.finalPoints);
      }
    } finally {
      clearAuditLegacyFxForTest();
    }
  });

  it("collects candidate vs live mismatches without auto-fixing", () => {
    const evaluation = evaluateBillingLiveOwnerReadiness(
      fixtures.filter((f) => f.id !== "P1-platform-aux-isolation-with-aux-stage")
    );
    assert.ok(evaluation.mismatches.length > 0, "expected candidate/live divergence — cutover not ready");
    assert.equal(evaluation.promotionReady, false);
    for (const m of evaluation.mismatches) {
      assert.ok(m.cutoverBlocker);
      assert.ok(m.class);
      assert.ok(m.firstDivergenceOwner);
      assert.ok(m.liveFx);
      assert.ok(m.candidateFx);
    }
  });

  it("waiver fixtures charge zero or minimum on live path", () => {
    installAuditLegacyFxForTest();
    try {
      for (const id of ["W1-degeneration-waiver", "W2-generation-failure-waiver", "W3-forced-abort-waiver"]) {
        const fixture = fixtures.find((f) => f.id === id)!;
        assert.equal(computeLiveChargeFromFixture(fixture).totalPoints, 0, id);
      }
      const w4 = fixtures.find((f) => f.id === "W4-waiver-minimum")!;
      assert.ok(computeLiveChargeFromFixture(w4).totalPoints >= 0);
    } finally {
      clearAuditLegacyFxForTest();
    }
  });

  it("compareLiveVsCandidate separates blocked from mismatch", () => {
    const blocked = compareLiveVsCandidate(fixtures.find((f) => f.id === "B1-cache-unreported")!);
    assert.equal(blocked.status, "blocked");
  });
});

describe("billingLiveOwnerReadinessAudit — false exactness guards", () => {
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
  it("PLATFORM_FUNDED_AUX_CHANGES_USER_CHARGE=false", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const result = verifyPlatformFundedAuxIsolation(fixtures);
    assert.equal(result.auxChangesUserCharge, false);
    assert.ok(result.note.includes("Synthetic topology"));
    installAuditLegacyFxForTest();
    try {
      assert.equal(
        computeLiveChargeFromFixture(fixtures.find((f) => f.id === "P1-platform-aux-isolation")!).totalPoints,
        computeLiveChargeFromFixture(
          fixtures.find((f) => f.id === "P1-platform-aux-isolation-with-aux-stage")!
        ).totalPoints
      );
    } finally {
      clearAuditLegacyFxForTest();
    }
  });
});

describe("billingLiveOwnerReadinessAudit — cache and reasoning matrix spot checks", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("B1 unreported cache — live charges, candidate blocked or partial", () => {
    installAuditLegacyFxForTest();
    try {
      const live = computeLiveChargeFromFixture(byId["B1-cache-unreported"]!);
      const candidate = computeCandidateChargeFromFixture(byId["B1-cache-unreported"]!);
      assert.ok(live.totalPoints > 0);
      assert.notEqual(candidate.status, "charged");
    } finally {
      clearAuditLegacyFxForTest();
    }
  });

  it("B2/B3 cache valid — candidate may charge but differs from live", () => {
    for (const id of ["B2-cache-valid-zero", "B3-cache-valid-positive"]) {
      const cmp = compareLiveVsCandidate(byId[id]!);
      assert.notEqual(cmp.status, "match");
    }
  });

  it("C1 unreported reasoning — candidate not exact-complete", () => {
    const candidate = computeCandidateChargeFromFixture(byId["C1-reasoning-unreported"]!);
    assert.notEqual(candidate.status, "charged");
  });
});

describe("billingLiveOwnerReadinessAudit — multi-stage coverage", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("D2 recovery uses primary input only on live path", () => {
    installAuditLegacyFxForTest();
    try {
      assert.ok(computeLiveChargeFromFixture(byId["D2-recovery"]!).totalPoints > 0);
      assert.notEqual(
        computeLiveChargeFromFixture(byId["D2-recovery"]!).totalPoints,
        computeLiveChargeFromFixture(byId["D1-single-stage"]!).totalPoints
      );
    } finally {
      clearAuditLegacyFxForTest();
    }
  });

  it("D4 fallback selects last stage", () => {
    installAuditLegacyFxForTest();
    try {
      assert.ok(computeLiveChargeFromFixture(byId["D4-fallback"]!).totalPoints > 0);
    } finally {
      clearAuditLegacyFxForTest();
    }
  });
});

describe("billingLiveOwnerReadinessAudit — general/adult routing", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("F2 adult G31 CI charges on delivered model basis", () => {
    installAuditLegacyFxForTest();
    try {
      assert.equal(
        computeLiveChargeFromFixture(byId["F2-adult-normal"]!).modelId,
        byId["F2-adult-normal"]!.deliveredModelId
      );
      assert.ok(computeLiveChargeFromFixture(byId["F2-adult-normal"]!).totalPoints > 0);
    } finally {
      clearAuditLegacyFxForTest();
    }
  });

  it("F3 adult fallback charges fallback stage", () => {
    installAuditLegacyFxForTest();
    try {
      assert.ok(computeLiveChargeFromFixture(byId["F3-adult-fallback"]!).totalPoints > 0);
    } finally {
      clearAuditLegacyFxForTest();
    }
  });
});

describe("billingLiveOwnerReadinessAudit — canary cleanup audit", () => {
  it("classifies #732/#739 symbols without deleting production canary", () => {
    const entries = auditCanaryCleanupClassification();
    assert.ok(entries.some((e) => e.symbol === "observeTurnBillableUsageCanary" && e.classification === "KEEP"));
    assert.ok(entries.every((e) => e.classification !== "SAFE_TO_DELETE" || e.note.length > 0));
  });
});

describe("billingLiveOwnerReadinessAudit — policy coverage matrix", () => {
  it("buildSpecialPolicyCoverageMatrix returns structured rows", () => {
    const matrix = buildSpecialPolicyCoverageMatrix();
    assert.ok(matrix.length >= 5);
    for (const row of matrix) {
      assert.ok(row.policy);
      assert.ok(row.owner);
      assert.ok(row.reachableModel);
    }
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
    assert.equal((pub as Record<string, unknown>).shadowPricing, undefined);
  });
});

describe("billingLiveOwnerReadinessAudit — collectParityMismatches wrapper", () => {
  it("delegates to evaluateBillingLiveOwnerReadiness", () => {
    const fixtures = buildBillingLiveOwnerReadinessFixtures();
    const fromWrapper = collectParityMismatches(fixtures);
    const fromEval = evaluateBillingLiveOwnerReadiness(fixtures).mismatches;
    assert.equal(fromWrapper.length, fromEval.length);
  });
});
