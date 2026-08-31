import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AUDIT_BASE_MAIN_SHA,
  BILLING_LIVE_OWNER_MAP,
  FROZEN_LIVE_CHARGE_GOLDEN,
  LIVE_BILLED_MODEL_FAMILIES,
  SPECIAL_BILLING_POLICIES,
  auditCanaryCleanupClassification,
  auditFalseExactnessGuards,
  auditInternalAsyncRecordReaders,
  buildBillingLiveOwnerReadinessFixtures,
  collectParityMismatches,
  compareLiveVsCandidate,
  computeCandidateChargeFromFixture,
  computeLiveChargeFromFixture,
  isTurnBillableUsageCanaryLiveInSource,
  verifyBaseVsHeadLiveParity,
  verifyPlatformFundedAuxIsolation,
} from "./billingLiveOwnerReadinessAudit";
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
    assert.ok(BILLING_LIVE_OWNER_MAP.CURRENT_LIVE_USER_CHARGE_OWNER.includes("computeTurnBilling"));
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

  it("lists live billed model families from code constants", () => {
    assert.ok(LIVE_BILLED_MODEL_FAMILIES.length >= 6);
    assert.ok(SPECIAL_BILLING_POLICIES.length >= 5);
  });

  it("TurnBillableUsage production canary is live in route.ts source", () => {
    assert.equal(isTurnBillableUsageCanaryLiveInSource(), true);
  });
});

describe("billingLiveOwnerReadinessAudit — BASE vs HEAD live parity gate", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();

  it("BASE_VS_HEAD_LIVE_MISMATCH_COUNT=0 for frozen golden fixtures", () => {
    const { mismatchCount, mismatches } = verifyBaseVsHeadLiveParity(fixtures);
    assert.equal(mismatchCount, 0, JSON.stringify(mismatches));
  });

  it("every golden fixture id exists in fixture builder", () => {
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
    const fixture = fixtures.find((f) => f.id === "B3-cache-valid-positive")!;
    const live = computeLiveChargeFromFixture(fixture);
    const candidate = computeCandidateChargeFromFixture(fixture);
    assert.ok(live.totalPoints > 0);
    assert.equal(candidate.status, "charged");
    if (candidate.status === "charged") {
      assert.notEqual(live.totalPoints, candidate.finalPoints);
    }
  });

  it("collects candidate vs live mismatches without auto-fixing", () => {
    const mismatches = collectParityMismatches(fixtures.filter((f) => f.id !== "P1-platform-aux-isolation-with-aux-stage"));
    assert.ok(mismatches.length > 0, "expected candidate/live divergence — cutover not ready");
    for (const m of mismatches) {
      assert.ok(m.cutoverBlocker);
      assert.ok(m.class);
      assert.ok(m.firstDivergenceOwner);
    }
  });

  it("waiver fixtures charge zero on live path", () => {
    for (const id of ["E1-waiver", "E2-waiver-min-not-applied-live"]) {
      const fixture = fixtures.find((f) => f.id === id)!;
      assert.equal(computeLiveChargeFromFixture(fixture).totalPoints, 0);
    }
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
    assert.equal(
      computeLiveChargeFromFixture(fixtures.find((f) => f.id === "P1-platform-aux-isolation")!).totalPoints,
      computeLiveChargeFromFixture(
        fixtures.find((f) => f.id === "P1-platform-aux-isolation-with-aux-stage")!
      ).totalPoints
    );
  });
});

describe("billingLiveOwnerReadinessAudit — cache and reasoning matrix spot checks", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("B1 unreported cache — live charges, candidate blocked or partial", () => {
    const live = computeLiveChargeFromFixture(byId["B1-cache-unreported"]!);
    const candidate = computeCandidateChargeFromFixture(byId["B1-cache-unreported"]!);
    assert.ok(live.totalPoints > 0);
    assert.notEqual(candidate.status, "charged");
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
    assert.equal(computeLiveChargeFromFixture(byId["D2-recovery"]!).totalPoints, 49);
    assert.notEqual(
      computeLiveChargeFromFixture(byId["D2-recovery"]!).totalPoints,
      computeLiveChargeFromFixture(byId["D1-single-stage"]!).totalPoints
    );
  });

  it("D4 fallback selects last stage", () => {
    assert.equal(computeLiveChargeFromFixture(byId["D4-fallback"]!).totalPoints, 152);
  });
});

describe("billingLiveOwnerReadinessAudit — general/adult routing", () => {
  const fixtures = buildBillingLiveOwnerReadinessFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("F2 adult OpenRouter model charges on delivered model basis", () => {
    assert.equal(computeLiveChargeFromFixture(byId["F2-adult-normal"]!).modelId, byId["F2-adult-normal"]!.modelId);
    assert.ok(computeLiveChargeFromFixture(byId["F2-adult-normal"]!).totalPoints > 0);
  });

  it("F3 adult fallback charges fallback stage", () => {
    assert.ok(computeLiveChargeFromFixture(byId["F3-adult-fallback"]!).totalPoints > 0);
  });
});

describe("billingLiveOwnerReadinessAudit — canary cleanup audit", () => {
  it("classifies #732/#739 symbols without deleting production canary", () => {
    const entries = auditCanaryCleanupClassification();
    assert.ok(entries.some((e) => e.symbol === "observeTurnBillableUsageCanary" && e.classification === "KEEP"));
    assert.ok(entries.every((e) => e.classification !== "SAFE_TO_DELETE" || e.note.length > 0));
  });
});

describe("billingLiveOwnerReadinessAudit — internal reader audit", () => {
  it("flags loadPreviousTurnStatusMeta as FOLLOW_UP on main", () => {
    const entries = auditInternalAsyncRecordReaders();
    const prev = entries.find((e) => e.reader.includes("loadPreviousTurnStatusMeta"));
    assert.ok(prev);
    assert.equal(prev!.classification, "FOLLOW_UP");
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
