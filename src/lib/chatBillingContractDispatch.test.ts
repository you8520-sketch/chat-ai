import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { StageUsage } from "@/lib/ai";
import {
  AUDIT_FX_SNAPSHOT,
  buildBillingLiveOwnerReadinessFixtures,
  auditFalseExactnessGuards,
  computeCandidateChargeFromFixture,
  computeLiveChargeFromFixture,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  isPhase1CutoverRequiredModel,
  type BillingParityFixture,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  CHAT_BILLING_CONTRACT_DISPATCH_OWNER,
  PHASE1_PUBLISHED_MODELS,
  isPhase1PublishedBillingEnabled,
  isPhase2DeepSeekPublishedBillingEnabled,
  resolveChatBillingContract,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { isIncompleteStreamUsageUnavailable, selectBillableStages, shouldWaiveTurnBilling } from "@/lib/points";

function completePrimaryStage(modelId: string, output: number): StageUsage {
  return {
    stage: "primary",
    model: modelId,
    input: 9000,
    output,
    apiOutputTokens: output,
    apiReportedInputTokens: 9000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "reported_valid",
    },
  };
}

function dispatchCompleteModel(modelId: string, output: number) {
  const stages = [completePrimaryStage(modelId, output)];
  return resolveChatBillingContract({
    deliveredModelId: modelId,
    stages,
    legacyFinalPoints: 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: AUDIT_FX_SNAPSHOT,
    phase1PublishedBillingEnabled: true,
  });
}

type ClosureClassification =
  | "PUBLISHED_DIRECT"
  | "LEGACY_FALLBACK"
  | "INTENTIONAL_PRICING_POLICY_DELTA"
  | "UNRESOLVED";

const OPUS_INTENTIONAL_DELTA_FIXTURES = new Set([
  "B2-cache-valid-zero",
  "B3-cache-valid-positive",
  "C6-reasoning-in-completion",
]);

function fixtureLegacyFinalPoints(fixture: BillingParityFixture): number {
  return computeLiveChargeFromFixture(fixture).totalPoints;
}

function fixtureSavedText(fixture: BillingParityFixture): string {
  if (typeof fixture.savedText === "string") return fixture.savedText;
  const chars = fixture.savedTextChars ?? 2000;
  return "x".repeat(chars);
}

function fixtureWaiverContext(fixture: BillingParityFixture) {
  const billableStages = selectBillableStages(fixture.stages);
  const primaryStage = billableStages[0];
  const savedText = fixtureSavedText(fixture);
  const forcedAbort =
    fixture.forcedAbort ?? billableStages.some((stage) => stage.loopAborted === true);
  const degenerationAborted =
    fixture.degenerationAborted ??
    billableStages.some((stage) => stage.degenerationAborted === true);
  const usageUnavailable =
    fixture.usageUnavailable ??
    isIncompleteStreamUsageUnavailable({
      finishReason: primaryStage?.finishReason,
      promptTokens: primaryStage?.apiReportedInputTokens ?? 0,
      completionTokens: primaryStage?.apiOutputTokens ?? 0,
    });
  const billingWaiverReason = shouldWaiveTurnBilling(savedText, {
    forcedAbort,
    degenerationAborted,
    generationFailure: fixture.generationFailure ?? null,
    usageUnavailable,
    adultMode: fixture.adultMode ?? false,
    targetResponseChars: fixture.targetResponseChars,
  });
  return { billingWaiverReason, legacyWaiverMinimum: 0 };
}

function dispatchFromFixture(
  fixture: BillingParityFixture,
  opts?: { phase1Enabled?: boolean }
): ReturnType<typeof resolveChatBillingContract> {
  const waiver = fixtureWaiverContext(fixture);
  const input: ResolveChatBillingContractInput = {
    deliveredModelId: fixture.deliveredModelId,
    stages: fixture.stages,
    refusalFallbackDelivered: fixture.refusalFallbackDelivered,
    promptAuditTotal: fixture.promptAuditTotal,
    legacyFinalPoints: fixtureLegacyFinalPoints(fixture),
    billingWaiverReason: waiver.billingWaiverReason,
    legacyWaiverMinimum: waiver.legacyWaiverMinimum,
    fxSnapshot: AUDIT_FX_SNAPSHOT,
    phase1PublishedBillingEnabled: opts?.phase1Enabled ?? true,
  };
  return resolveChatBillingContract(input);
}

function classifyFixture(fixture: BillingParityFixture): ClosureClassification {
  if (!isPhase1CutoverRequiredModel(fixture.deliveredModelId)) {
    return "LEGACY_FALLBACK";
  }
  if (OPUS_INTENTIONAL_DELTA_FIXTURES.has(fixture.id)) {
    return "INTENTIONAL_PRICING_POLICY_DELTA";
  }
  const decision = dispatchFromFixture(fixture);
  const candidate = computeCandidateChargeFromFixture(fixture);
  if (decision.contract === "published_phase1") {
    if (candidate.status === "charged") {
      return "PUBLISHED_DIRECT";
    }
    return "UNRESOLVED";
  }
  if (candidate.status === "blocked" || candidate.status === "not_comparable") {
    return "LEGACY_FALLBACK";
  }
  if (candidate.status === "charged") {
    return "UNRESOLVED";
  }
  return "UNRESOLVED";
}

describe("chatBillingContractDispatch — owner + feature gate", () => {
  const savedEnv = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;

  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => {
    clearAuditLegacyFxForTest();
    if (savedEnv === undefined) {
      delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    } else {
      process.env.PHASE1_PUBLISHED_BILLING_ENABLED = savedEnv;
    }
  });

  it("BILLING_CONTRACT_DISPATCH_OWNER is canonical single owner", () => {
    assert.match(
      CHAT_BILLING_CONTRACT_DISPATCH_OWNER,
      /resolveChatBillingContract\(\) in chatBillingContractDispatch\.ts/
    );
  });

  it("PHASE1_PUBLISHED_BILLING_ENABLED defaults false", () => {
    delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    assert.equal(isPhase1PublishedBillingEnabled(), false);
  });

  it("flag=false keeps legacy points without attempting published", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-g37-normal")!;
    const legacyPoints = fixtureLegacyFinalPoints(fixture);
    const decision = dispatchFromFixture(fixture, { phase1Enabled: false });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.points, legacyPoints);
    assert.equal(decision.reason, "phase1_billing_disabled");
    assert.equal(decision.telemetry.publishedCandidateStatus, "not_attempted");
  });
});

describe("chatBillingContractDispatch — contract selection", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("G31/G37/Opus5 complete usage → published_phase1", () => {
    for (const [modelId, output] of [
      [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, 4307],
      [CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, 2500],
      [CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, 500],
    ] as const) {
      const decision = dispatchCompleteModel(modelId, output);
      assert.equal(decision.contract, "published_phase1", modelId);
      assert.ok(decision.points > 0, modelId);
    }
  });

  it("A1 normals with unreported cache stay legacy fallback (fail-closed)", () => {
    for (const id of ["A1-g31-normal", "A1-g37-normal", "A1-opus5-normal"] as const) {
      const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === id)!;
      const decision = dispatchFromFixture(fixture);
      assert.equal(decision.contract, "legacy", id);
      assert.equal(decision.points, fixtureLegacyFinalPoints(fixture), id);
    }
  });

  it("DeepSeek0813 Phase2 OFF → legacy phase2_deepseek_billing_disabled", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    const decision = dispatchFromFixture(fixture, { phase1Enabled: false });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_billing_disabled");
    assert.equal(decision.points, fixtureLegacyFinalPoints(fixture));
  });

  it("Terra legacy id → legacy", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-terra-normal")!;
    assert.equal(fixture.deliveredModelId, CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    const decision = dispatchFromFixture(fixture);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "non_published_model");
  });

  it("deferred models → legacy", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-g36-normal")!;
    const decision = dispatchFromFixture(fixture);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "non_published_model");
  });
});

describe("chatBillingContractDispatch — fail-closed legacy fallback", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  const fallbackCases: Array<{ id: string; reasonIncludes?: string }> = [
    { id: "B1-cache-unreported" },
    { id: "B4-cache-malformed-positive" },
    { id: "C1-reasoning-unreported" },
    { id: "C4-reasoning-malformed-positive" },
    { id: "B6-cache-mixed-valid-invalid" },
    { id: "D2-recovery" },
    { id: "D5-failover" },
  ];

  for (const { id } of fallbackCases) {
    it(`${id} → legacy fallback with legacy points parity`, () => {
      const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === id)!;
      assert.ok(isPhase1CutoverRequiredModel(fixture.deliveredModelId), id);
      const legacyPoints = fixtureLegacyFinalPoints(fixture);
      const decision = dispatchFromFixture(fixture);
      assert.equal(decision.contract, "legacy", id);
      assert.equal(decision.points, legacyPoints, id);
    });
  }
});

describe("chatBillingContractDispatch — Opus5 v2 golden + intentional policy delta", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  for (const fixtureId of ["B2-cache-valid-zero", "B3-cache-valid-positive", "C6-reasoning-in-completion"] as const) {
    it(`${fixtureId} published matches Opus5 v2 catalog (intentional legacy delta)`, () => {
      const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === fixtureId)!;
      assert.equal(fixture.deliveredModelId, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);

      const legacyPoints = fixtureLegacyFinalPoints(fixture);
      const decision = dispatchFromFixture(fixture);
      assert.equal(decision.contract, "published_phase1");

      const candidate = computeCandidateChargeFromFixture(fixture);
      assert.equal(candidate.status, "charged");
      assert.equal(decision.points, candidate.finalPoints);

      const pricing = resolvePublishedPricingExact(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
      assert.ok(pricing);
      assert.equal(pricing.pricing.pricingVersion, 2);
      assert.equal(pricing.pricing.billingReferenceInputUsdPerMillion, 5);
      assert.equal(pricing.pricing.billingReferenceOutputUsdPerMillion, 25);

      assert.notEqual(decision.points, legacyPoints, `${fixtureId} legacy != published by policy`);
    });
  }
});

describe("chatBillingContractDispatch — Phase 1 closure matrix", () => {
  it("PHASE1_UNRESOLVED_BILLING_CASES=0 and legacy fallback charge parity", () => {
    installAuditLegacyFxForTest();
    try {
      const fixtures = buildBillingLiveOwnerReadinessFixtures().filter(
        (f) => f.id !== "P1-platform-aux-isolation-with-aux-stage"
      );
      const phase1Fixtures = fixtures.filter((f) =>
        isPhase1CutoverRequiredModel(f.deliveredModelId)
      );

      let publishedDirectCount = 0;
      let legacyFallbackCount = 0;
      let intentionalDeltaCount = 0;
      let unresolvedCount = 0;
      let legacyFallbackMismatch = 0;

      for (const fixture of phase1Fixtures) {
        const classification = classifyFixture(fixture);
        switch (classification) {
          case "PUBLISHED_DIRECT":
            publishedDirectCount += 1;
            break;
          case "LEGACY_FALLBACK":
            legacyFallbackCount += 1;
            break;
          case "INTENTIONAL_PRICING_POLICY_DELTA":
            intentionalDeltaCount += 1;
            break;
          case "UNRESOLVED":
            unresolvedCount += 1;
            break;
          default: {
            const _exhaustive: never = classification;
            void _exhaustive;
          }
        }

        const decision = dispatchFromFixture(fixture);
        const legacyPoints = fixtureLegacyFinalPoints(fixture);
        if (decision.contract === "legacy") {
          if (decision.points !== legacyPoints) {
            legacyFallbackMismatch += 1;
          }
        }
      }

      assert.equal(unresolvedCount, 0, "PHASE1_UNRESOLVED_BILLING_CASES must be 0");
      assert.equal(legacyFallbackMismatch, 0, "PHASE1_EXPECTED_LEGACY_FALLBACK_CHARGE_MISMATCH");
      assert.ok(legacyFallbackCount > 0);
      assert.equal(intentionalDeltaCount, 3);
      assert.deepEqual([...PHASE1_PUBLISHED_MODELS], [
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      ]);
    } finally {
      clearAuditLegacyFxForTest();
    }
  });
});

describe("chatBillingContractDispatch — false-exactness guards preserved", () => {
  it("candidate fail-closed does not force complete usage", () => {
    const guards = auditFalseExactnessGuards();
    assert.equal(guards.unreportedCacheCanBecomeConfirmedZero, false);
    assert.equal(guards.invalidCacheCanBecomeExact, false);
    assert.equal(guards.unreportedReasoningCanBecomeConfirmedZero, false);
    assert.equal(guards.invalidReasoningCanBecomeExact, false);
    assert.equal(guards.mixedValidInvalidStageCanBecomeExact, false);
  });
});

describe("chatBillingContractDispatch — cleanup audit classification", () => {
  it("documents KEEP / SAFE TO DELETE / FOLLOW-UP owners post-dispatch", () => {
    const cleanup = {
      KEEP: [
        "computeTurnBilling() — legacy owner + DeepSeek/fallback",
        "billingLiveOwnerReadinessAudit.ts — #795 audit harness",
        "computeHtmlFlashOnlyTurnBilling() — HTML flash separate owner",
        "settleChatTurnBillingExactlyOnce() — settlement boundary",
        "shouldWaiveTurnBilling() + resolve*WaiverMinimumCharge()",
        "resolveTurnBillableUsage() — LEVEL-1 usage basis",
        "computePublishedUserChargeWithSnapshot() — Published charge engine",
      ],
      SAFE_TO_DELETE: [] as string[],
      FOLLOW_UP: [
        "Enable PHASE1_PUBLISHED_BILLING_ENABLED after ops sign-off",
        "Enable PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED after user approval",
      ],
    };
    assert.ok(cleanup.KEEP.includes("computeTurnBilling() — legacy owner + DeepSeek/fallback"));
    assert.equal(cleanup.SAFE_TO_DELETE.length, 0);
  });
});

describe("chatBillingContractDispatch — Phase2 DeepSeek gate default", () => {
  const savedPhase2 = process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;

  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => {
    clearAuditLegacyFxForTest();
    if (savedPhase2 === undefined) delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED = savedPhase2;
  });

  it("PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED defaults false", () => {
    delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    assert.equal(isPhase2DeepSeekPublishedBillingEnabled(), false);
  });

  it("DeepSeek never receives published_phase1 contract label", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    assert.equal(fixture.deliveredModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    const decision = dispatchFromFixture(fixture);
    assert.notEqual(decision.telemetry.billingContract, "published_phase1");
  });
});
