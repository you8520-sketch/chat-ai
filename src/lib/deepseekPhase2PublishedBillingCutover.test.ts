import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  AUDIT_FX_SNAPSHOT,
  buildBillingLiveOwnerReadinessFixtures,
  computeLiveChargeFromFixture,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  isPhase2DeepSeekPublishedBillingEnabled,
  PHASE2_DEEPSEEK_PUBLISHED_MODEL,
  resolveChatBillingContract,
  shouldPreparePublishedBillingFxSnapshot,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import {
  buildUsageBillingContractAdmin,
  applyFinalUserChargeToUsage,
} from "@/lib/chatBillingFinalCharge";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import { getModelPublishedPricingPolicy, isPublishedCacheWriteAbsentProvenZero } from "@/lib/modelPublishedPricingPolicy";

const FX_DETERMINISTIC: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const GOLDEN_INPUT = 33_247;
const GOLDEN_OUTPUT = 3_461;
const GOLDEN_POINTS = 90;

const CACHE_HIT_INPUT = 12_871;
const CACHE_HIT_READ = 12_800;
const CACHE_HIT_OUTPUT = 1_273;
const CACHE_HIT_POINTS = 9;

function completeDeepSeekStage(
  partial: Partial<StageUsage> & Pick<StageUsage, "stage">
): StageUsage {
  const input = partial.input ?? GOLDEN_INPUT;
  const output = partial.output ?? GOLDEN_OUTPUT;
  const cacheRead = partial.cacheReadTokens ?? 0;
  const cacheWrite = partial.cacheWriteTokens ?? 0;
  return {
    estimated: false,
    model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    input,
    output,
    apiOutputTokens: partial.apiOutputTokens ?? output,
    apiReportedInputTokens: partial.apiReportedInputTokens ?? input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: cacheWrite > 0 ? "reported_valid" : "unreported",
      reasoning: "reported_valid",
    },
    ...partial,
  };
}

function dispatchDeepSeek(
  stages: StageUsage[],
  opts?: Partial<ResolveChatBillingContractInput>
): ReturnType<typeof resolveChatBillingContract> {
  const legacyFinalPoints = opts?.legacyFinalPoints ?? 999;
  const selectedModelId =
    opts?.selectedModelId ?? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
  return resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    selectedModelId,
    stages,
    legacyFinalPoints,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX_DETERMINISTIC,
    phase1PublishedBillingEnabled: false,
    phase2DeepSeekPublishedBillingEnabled: true,
    ...opts,
    selectedModelId,
  });
}

describe("deepseekPhase2PublishedBillingCutover — gate + FX owner", () => {
  const savedPhase2 = process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
  const savedPhase1 = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;

  afterEach(() => {
    if (savedPhase2 === undefined) delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED = savedPhase2;
    if (savedPhase1 === undefined) delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE1_PUBLISHED_BILLING_ENABLED = savedPhase1;
  });

  it("PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED defaults false", () => {
    delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    assert.equal(isPhase2DeepSeekPublishedBillingEnabled(), false);
  });

  it("shouldPreparePublishedBillingFxSnapshot true when Phase2 ON and Phase1 OFF", () => {
    delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED = "1";
    assert.equal(isPhase2DeepSeekPublishedBillingEnabled(), true);
    assert.equal(shouldPreparePublishedBillingFxSnapshot(), true);
  });

  it("PHASE2_DEEPSEEK_PUBLISHED_MODEL is canonical deepseek-v4-pro-0813 only", () => {
    assert.equal(PHASE2_DEEPSEEK_PUBLISHED_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(isPublishedCacheWriteAbsentProvenZero(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), true);
    const deepseekPolicy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(deepseekPolicy?.cacheWriteAbsentSemantics, "proven_zero");
    assert.equal(isPublishedCacheWriteAbsentProvenZero(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), false);
    assert.notEqual(
      getModelPublishedPricingPolicy(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL)?.cacheWriteAbsentSemantics,
      "proven_zero"
    );
  });
});

describe("deepseekPhase2PublishedBillingCutover — golden fixtures", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("competitor fixture → published_phase2 exactly 90P", () => {
    const stages = [completeDeepSeekStage({ stage: "primary" })];
    const decision = dispatchDeepSeek(stages);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.reason, "phase2_deepseek_live_grade");
    assert.equal(decision.points, GOLDEN_POINTS);
    assert.equal(decision.telemetry.pricingVersion, 2);
    assert.equal(decision.telemetry.billingContract, "published_phase2");
    assert.notEqual(decision.telemetry.billingContract, "published_phase1");
  });

  it("cache-hit fixture → published_phase2 exactly 9P with cache read rate", () => {
    const stages = [
      completeDeepSeekStage({
        stage: "primary",
        input: CACHE_HIT_INPUT,
        output: CACHE_HIT_OUTPUT,
        cacheReadTokens: CACHE_HIT_READ,
      }),
    ];
    const decision = dispatchDeepSeek(stages);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.points, CACHE_HIT_POINTS);
  });

  it("absent cache_write field → complete usage via proven-zero owner", () => {
    const stage = completeDeepSeekStage({ stage: "primary" });
    delete (stage as { cacheWriteTokens?: number }).cacheWriteTokens;
    stage.usageReportingEvidence = {
      cacheRead: "reported_valid",
      cacheWrite: "unreported",
      reasoning: "reported_valid",
    };
    const usage = resolveTurnBillableUsage({
      stages: [stage],
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    });
    assert.equal(usage.status, "resolved");
    if (usage.status === "resolved") {
      assert.equal(usage.usageCoverage, "complete");
      assert.equal(usage.diagnostics.fieldSources.cacheWrite, "MISSING_BUT_PROVEN_ZERO");
    }
  });
});

describe("deepseekPhase2PublishedBillingCutover — direct routing matrix D1-D10", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("D1 Phase2 OFF → legacy phase2_deepseek_billing_disabled", () => {
    const stages = [completeDeepSeekStage({ stage: "primary" })];
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stages,
      legacyFinalPoints: 65,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: false,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_billing_disabled");
    assert.equal(decision.points, 65);
  });

  it("D2 direct normal + Phase2 ON + complete → published_phase2", () => {
    const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: "primary" })]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.points, GOLDEN_POINTS);
  });

  it("D3 continue + Phase2 ON → published_phase2", () => {
    const decision = dispatchDeepSeek([
      completeDeepSeekStage({ stage: "continuation", input: 10_000, output: 2000 }),
    ]);
    assert.equal(decision.contract, "published_phase2");
    assert.ok(decision.points > 0);
  });

  it("D4 regenerate + Phase2 ON → published_phase2", () => {
    const decision = dispatchDeepSeek([
      completeDeepSeekStage({ stage: "regenerate", input: 8000, output: 1500 }),
    ]);
    assert.equal(decision.contract, "published_phase2");
    assert.ok(decision.points > 0);
  });

  it("D5 cache hit + complete → published_phase2", () => {
    const decision = dispatchDeepSeek([
      completeDeepSeekStage({
        stage: "primary",
        input: CACHE_HIT_INPUT,
        output: CACHE_HIT_OUTPUT,
        cacheReadTokens: CACHE_HIT_READ,
      }),
    ]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.points, CACHE_HIT_POINTS);
  });

  it("D6 cacheWriteTokens>0 → legacy published_blocked", () => {
    const decision = dispatchDeepSeek([
      completeDeepSeekStage({ stage: "primary", cacheWriteTokens: 2000 }),
    ]);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "unsupported_cache_semantics");
  });

  it("D7 incomplete usage (cache_read unreported) → legacy usage_coverage_incomplete", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    const legacyPoints = computeLiveChargeFromFixture(fixture).totalPoints;
    const decision = resolveChatBillingContract({
      deliveredModelId: fixture.deliveredModelId,
      selectedModelId: fixture.deliveredModelId,
      stages: fixture.stages,
      legacyFinalPoints: legacyPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "usage_coverage_incomplete");
  });

  it("D8 unknown usage (no stages) → legacy usage_unresolved", () => {
    const decision = dispatchDeepSeek([], { legacyFinalPoints: 50 });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "usage_unresolved");
  });

  it("D9 invalid FX snapshot → legacy invalid_fx_snapshot", () => {
    const invalidFx: BillingFxSnapshot = { ...FX_DETERMINISTIC, locked: false };
    const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: "primary" })], {
      fxSnapshot: invalidFx,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "invalid_fx_snapshot");
  });

  it("D10 waiver minimum > 0 → legacy legacy_waiver_minimum_nonzero", () => {
    const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: "primary" })], {
      legacyWaiverMinimum: 40,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "legacy_waiver_minimum_nonzero");
  });
});

describe("deepseekPhase2PublishedBillingCutover — refusal fallback matrix F1-F4", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  function dispatchRefusalFallback(
    stages: StageUsage[],
    legacyFinalPoints: number,
    selectedModelId: string
  ): ReturnType<typeof resolveChatBillingContract> {
    return resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId,
      stages,
      refusalFallbackDelivered: true,
      legacyFinalPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
  }

  it("F1 Gemini refusal → DeepSeek fallback → legacy phase2_refusal_fallback_legacy", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "F3-adult-fallback")!;
    const legacyPoints = computeLiveChargeFromFixture(fixture).totalPoints;
    const decision = dispatchRefusalFallback(
      fixture.stages,
      legacyPoints,
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_refusal_fallback_legacy");
    assert.equal(decision.points, legacyPoints);
    assert.notEqual(decision.telemetry.billingContract, "published_phase2");
  });

  it("F2 Opus refusal → DeepSeek fallback → legacy phase2_refusal_fallback_legacy", () => {
    const stages: StageUsage[] = [
      {
        stage: "primary-refused",
        model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        input: 8000,
        output: 100,
        apiOutputTokens: 100,
        estimated: false,
      },
      {
        stage: "fallback",
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        input: 9500,
        output: 1200,
        apiOutputTokens: 1200,
        apiReportedInputTokens: 9500,
        estimated: false,
      },
    ];
    const decision = dispatchRefusalFallback(stages, 88, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_refusal_fallback_legacy");
  });

  it("F3 direct DeepSeek refusalFallbackDelivered=false → published_phase2 eligible", () => {
    const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: "primary" })], {
      refusalFallbackDelivered: false,
    });
    assert.equal(decision.contract, "published_phase2");
  });

  it("F4 Adult Mode ON without refusal → G31 selected model billing unchanged", () => {
    const general = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "F1-general-normal")!;
    const adult = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "F2-adult-normal")!;
    assert.equal(adult.deliveredModelId, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.notEqual(adult.deliveredModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    const generalDecision = resolveChatBillingContract({
      deliveredModelId: general.deliveredModelId,
      stages: general.stages,
      legacyFinalPoints: computeLiveChargeFromFixture(general).totalPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: true,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    const adultDecision = resolveChatBillingContract({
      deliveredModelId: adult.deliveredModelId,
      stages: adult.stages,
      legacyFinalPoints: computeLiveChargeFromFixture(adult).totalPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: true,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(adultDecision.contract, generalDecision.contract);
    assert.notEqual(adultDecision.reason, "phase2_refusal_fallback_legacy");
    assert.notEqual(adultDecision.telemetry.billingContract, "published_phase2");
  });
});

describe("deepseekPhase2PublishedBillingCutover — Phase1 regression unchanged", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("Phase1 Opus B2 stays published_phase1 when Phase2 also ON", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "B2-cache-valid-zero")!;
    const legacyPoints = computeLiveChargeFromFixture(fixture).totalPoints;
    const decision = resolveChatBillingContract({
      deliveredModelId: fixture.deliveredModelId,
      selectedModelId: fixture.deliveredModelId,
      stages: fixture.stages,
      legacyFinalPoints: legacyPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: true,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "published_phase1");
    assert.notEqual(decision.contract, "published_phase2");
  });
});

describe("deepseekPhase2PublishedBillingCutover — admin receipt + settlement", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("published_phase2 sets publishedFinalPoints on admin receipt", () => {
    const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: "primary" })]);
    assert.equal(decision.contract, "published_phase2");
    const admin = buildUsageBillingContractAdmin(decision, decision.points, 65);
    assert.equal(admin.publishedFinalPoints, GOLDEN_POINTS);
    assert.equal(admin.billingContract, "published_phase2");
    const usage = applyFinalUserChargeToUsage(
      {
        input: GOLDEN_INPUT,
        output: GOLDEN_OUTPUT,
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        route: "safe",
        cost: decision.points,
        breakdown: [],
      },
      decision.points,
      admin
    );
    const receipt = buildAdminBillingReceiptV2(usage);
    assert.equal(receipt.userCharge.billingContract, "published_phase2");
    assert.equal(receipt.userCharge.publishedFinalPoints, GOLDEN_POINTS);
    assert.equal(receipt.userCharge.deductedPoints, GOLDEN_POINTS);
    assert.equal(usage.cost, decision.points);
  });
});

describe("deepseekPhase2PublishedBillingCutover — direct selection matrix S1-S5", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  const completeStage = () => completeDeepSeekStage({ stage: "primary" });

  it("S1 selected=DeepSeek delivered=DeepSeek → published_phase2", () => {
    const decision = dispatchDeepSeek([completeStage()]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.telemetry.selectedModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });

  it("S2 selected=Gemini delivered=DeepSeek → legacy phase2_deepseek_not_direct_selected", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      stages: [completeStage()],
      refusalFallbackDelivered: false,
      legacyFinalPoints: 65,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_not_direct_selected");
  });

  it("S3 selected=Opus delivered=DeepSeek refusalFallback → legacy phase2_refusal_fallback_legacy", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      stages: [completeStage()],
      refusalFallbackDelivered: true,
      legacyFinalPoints: 88,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_refusal_fallback_legacy");
  });

  it("S4 selected=DeepSeek alias delivered=0813 → published_phase2 eligible", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: "deepseek-v4-pro",
      stages: [completeStage()],
      refusalFallbackDelivered: false,
      legacyFinalPoints: 65,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.points, GOLDEN_POINTS);
  });

  it("S5 selected=DeepSeek Flash delivered=0813 → legacy phase2_deepseek_not_direct_selected", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      stages: [completeStage()],
      refusalFallbackDelivered: false,
      legacyFinalPoints: 65,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX_DETERMINISTIC,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_not_direct_selected");
  });

  for (const stageName of ["primary", "continuation", "regenerate"] as const) {
    it(`direct selection uses selectedModelId consistently for ${stageName}`, () => {
      const decision = dispatchDeepSeek([completeDeepSeekStage({ stage: stageName })]);
      assert.equal(decision.contract, "published_phase2");
      assert.equal(decision.telemetry.selectedModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    });
  }
});
