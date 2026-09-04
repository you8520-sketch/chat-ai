/**
 * G37 P0 Pass 2 — production forensic regression (R1 normal shadow, R2 regen dispatch).
 * Uses canonical owners only — no mock published producer, no test DI surface.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { assertPublishedBuildArtifactGuard } from "@/lib/publishedUserChargeBuildArtifactGuard";
import { computeShadowPricing } from "@/lib/shadowPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
} from "@/lib/shadowBillingExchangeRate";
import { ensureShadowBillingFxTables } from "@/lib/shadowBillingFxPersistence";
import type { StageUsage } from "@/lib/ai";
import type { NormalizedBillableUsage } from "@/lib/billingUsage";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";

export const FIXED_TEST_KST_DATE = "2026-08-28";
export const FIXED_TEST_USD_KRW = 1530;

const FIXED_TEST_FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: FIXED_TEST_KST_DATE,
  usdToKrw: FIXED_TEST_USD_KRW,
  effectiveKrwPerUsd: applyOverseasCardFee(FIXED_TEST_USD_KRW),
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

/**
 * cr_mtiedirf_thf6vkus — provider-reported normal G37 turn (chatId=707).
 * FORENSIC_EXACT_FIELDS:
 * promptTokens, cacheReadTokens, cacheWriteTokens, standardInputTokens,
 * visibleOutputTokens, billableOutputTokens (all explicit in production logs).
 */
const NORMAL_PRODUCTION_SHAPE_FIXTURE: NormalizedBillableUsage = {
  promptTokens: 26038,
  cacheReadTokens: 20426,
  cacheWriteTokens: 0,
  standardInputTokens: 5612,
  visibleOutputTokens: 2662,
  reasoningTokens: 0,
  billableOutputTokens: 2662,
  reasoningAccounting: "none",
};

/**
 * cr_mtiei4j7_c39yk536 — regen G37 turn (same messageId=3895).
 * FORENSIC_EXACT_FIELDS: promptTokens, visibleOutputTokens/billableOutputTokens,
 * cacheReadTokens=0, cacheWriteTokens=0, standardInputTokens, usageCoverage=complete.
 * FORENSIC_SYNTHETIC_COMPLETION_FIELDS: reasoningTokens=0 (fieldSources.reasoning=MISSING_AND_UNKNOWN).
 */
const REGEN_FORENSIC_PARTIAL_PLUS_DETERMINISTIC_FILL: NormalizedBillableUsage = {
  promptTokens: 26681,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  standardInputTokens: 26681,
  visibleOutputTokens: 3184,
  reasoningTokens: 0,
  billableOutputTokens: 3184,
  reasoningAccounting: "none",
};

function regenProductionShapeStage(): StageUsage {
  return {
    stage: "Gemini 3.7 Flash",
    model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    input: 26681,
    output: 3184,
    apiOutputTokens: 3184,
    apiReportedInputTokens: 26681,
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

describe("G37 P0 Pass 2 — forensic published owner regressions", () => {
  let shadowFxDb: Database.Database | null = null;

  beforeEach(() => {
    shadowFxDb = new Database(":memory:");
    ensureShadowBillingFxTables(shadowFxDb);
    _setShadowBillingFxTestDb(shadowFxDb);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse(`${FIXED_TEST_KST_DATE}T00:00:00.000Z`));
    _insertShadowBillingFxDailyRowForTest({
      dateKey: FIXED_TEST_KST_DATE,
      baseUsdKrw: FIXED_TEST_USD_KRW,
      source: "api_daily",
    });
  });

  afterEach(() => {
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(null);
    shadowFxDb?.close();
    shadowFxDb = null;
  });

  it("R1 normal shadow: computeShadowPricing complete path never nullish .status", () => {
    const shadow = computeShadowPricing({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: NORMAL_PRODUCTION_SHAPE_FIXTURE.promptTokens,
      cacheReadTokens: NORMAL_PRODUCTION_SHAPE_FIXTURE.cacheReadTokens,
      cacheWriteTokens: NORMAL_PRODUCTION_SHAPE_FIXTURE.cacheWriteTokens,
      outputTokens: NORMAL_PRODUCTION_SHAPE_FIXTURE.visibleOutputTokens,
    });
    assert.ok(shadow.publishedChargeStatus === "complete" || shadow.publishedChargeStatus === "blocked");
    assert.notEqual(shadow.publishedChargeStatus, undefined);
  });

  it("R1 direct published owner: normal forensic usage returns total union (not undefined)", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: NORMAL_PRODUCTION_SHAPE_FIXTURE,
      usageCoverage: "complete",
      fxSnapshot: FIXED_TEST_FX,
      adjustment: { kind: "none" },
    });
    assert.notEqual(result, undefined);
    assert.notEqual(result, null);
    assert.ok(result.status === "complete" || result.status === "blocked");
    if (result.status === "blocked") {
      assert.equal(result.reason, "unsupported_cache_semantics");
    }
  });

  it("R2 regen dispatch: resolveChatBillingContract published_phase1 with forensic stage", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      stages: [regenProductionShapeStage()],
      legacyFinalPoints: 61,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FIXED_TEST_FX,
      phase1PublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "published_phase1");
    assert.ok(decision.points > 0);
    assert.equal(decision.telemetry.publishedCandidateStatus, "resolved");
  });

  it("R2 direct published owner: regen forensic usage returns complete total union (not undefined)", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: REGEN_FORENSIC_PARTIAL_PLUS_DETERMINISTIC_FILL,
      usageCoverage: "complete",
      fxSnapshot: FIXED_TEST_FX,
      adjustment: { kind: "none" },
    });
    assert.notEqual(result, undefined);
    assert.notEqual(result, null);
    assert.equal(result.status, "complete");
    if (result.status === "complete") {
      assert.ok(result.snapshot.finalPoints > 0);
    }
  });
});

describe("G37 P0 Pass 2 — build artifact parity guard (fail-closed)", () => {
  it("requires npm run build output and exactly one semantic published owner with complete return", () => {
    const result = assertPublishedBuildArtifactGuard();
    assert.equal(result.matchedPublishedBuildOwnerCount, 1);
    assert.equal(result.completePathReturnPresent, true);
  });
});
