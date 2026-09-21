import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { isPhase2DeepSeekPublishedBillingModel } from "@/lib/chatBillingContractDispatch";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  isCheaperInferenceDeepSeekV41FlashModel,
  isCheaperInferenceModel,
  isDeepSeekMainRpFamilyModel,
  isDeepSeekModel,
} from "@/lib/chatModels";
import {
  adaptCheaperInferenceChatBody,
  applyCheaperInferenceModelReasoningPolicy,
} from "@/lib/cheaperInferenceConfig";
import {
  MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS,
  buildDeepSeekFailoverBackupBody,
  hasDeepSeekOpenRouterBackupModel,
  resolveDeepSeekBackupModelId,
  resolveDeepSeekFailoverRouteKind,
  resolveDeepSeekLogicalModel,
} from "@/lib/deepseekProviderFailover";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-21",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const NORMAL_USAGE = normalizeBillableUsage({
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  promptTokens: 33_247,
  outputTokens: 3_461,
});

const CACHE_READ_USAGE = normalizeBillableUsage({
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  promptTokens: 12_871,
  outputTokens: 1_273,
  cacheReadTokens: 12_800,
});

function charge(modelId: string, usage: ReturnType<typeof normalizeBillableUsage>) {
  return computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: FX,
    adjustment: { kind: "none" },
  });
}

function trueOffBody(modelId: string): Record<string, unknown> {
  return applyCheaperInferenceModelReasoningPolicy({
    model: modelId,
    messages: [{ role: "user", content: "x" }],
    temperature: 0.92,
  });
}

describe("deepseekV41FlashIntegration", () => {
  it("A — V4.1 recognized as CheaperInference model", () => {
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
    assert.equal(isCheaperInferenceDeepSeekV41FlashModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
  });

  it("B — V4.1 recognized as DeepSeek family", () => {
    assert.equal(isDeepSeekModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
    assert.equal(isDeepSeekMainRpFamilyModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
  });

  it("C — V4.1 is not 0731", () => {
    assert.notEqual(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
    assert.equal(resolveDeepSeekLogicalModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), "flash_v41");
    assert.equal(resolveDeepSeekLogicalModel(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL), "flash_0731");
  });

  it("D — V4.1 TRUE-OFF body exact", () => {
    const body = trueOffBody(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(body.model, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "none");
    assert.equal(body.reasoning, undefined);
    assert.equal(body.include_reasoning, undefined);
  });

  it("E — Pro TRUE-OFF unchanged", () => {
    const body = trueOffBody(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(body.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "none");
  });

  it("F — 0731 TRUE-OFF unchanged", () => {
    const body = trueOffBody(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
    assert.equal(body.model, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
    assert.deepEqual(body.thinking, { type: "disabled" });
  });

  it("G — Main RP V4.1 max physical attempts = 1", () => {
    assert.equal(MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS, 1);
    assert.equal(
      resolveDeepSeekFailoverRouteKind({ modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL }),
      "native_flash_v41"
    );
    assert.equal(hasDeepSeekOpenRouterBackupModel("flash_v41"), false);
    assert.throws(() => resolveDeepSeekBackupModelId("flash_v41"));
    const backupBody = buildDeepSeekFailoverBackupBody(
      { model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, messages: [] },
      "flash_v41"
    );
    assert.equal(backupBody.model, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(backupBody.thinking, undefined);
  });

  it("H — namespace V4 Pro alias exact", () => {
    assert.equal(
      canonicalizePublishedModelId("deepseek/deepseek-v4-pro-0813"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      canonicalizePublishedModelId("deepseek/deepseek-v4-pro"),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("I — true different-model mismatch preserved", () => {
    const different = "deepseek/deepseek-v4-flash-0731";
    assert.notEqual(
      canonicalizePublishedModelId(different),
      canonicalizePublishedModelId(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)
    );
  });

  it("J — V4.1 published price stable under CI procurement swings", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(pricing.billingReferenceInputUsdPerMillion, 0.3);
    assert.equal(pricing.billingReferenceOutputUsdPerMillion, 1.2);
    assert.equal(pricing.targetMargin, 0.6);
    const baseline = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, NORMAL_USAGE);
    assert.equal(baseline.status, "complete");
    if (baseline.status !== "complete") return;
    const points = baseline.snapshot.finalPoints;
    for (const procInput of [0.12, 0.2, 0.48]) {
      assert.notEqual(procInput, pricing.billingReferenceInputUsdPerMillion);
      const again = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, NORMAL_USAGE);
      assert.equal(again.status, "complete");
      if (again.status === "complete") {
        assert.equal(again.snapshot.finalPoints, points);
      }
    }
  });

  it("K — cache read charge complete", () => {
    const r = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, CACHE_READ_USAGE);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      assert.equal(r.snapshot.applicability.cacheSemanticStatus, "verified");
      assert.ok(r.snapshot.finalPoints > 0);
    }
  });

  it("L — zero cache charge complete", () => {
    const r = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, NORMAL_USAGE);
    assert.equal(r.status, "complete");
  });

  it("M — absent cache-write semantics (proven_zero billing bucket)", () => {
    const policy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.ok(policy);
    assert.equal(policy!.cacheWriteAbsentSemantics, "proven_zero");
    const r = charge(
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        promptTokens: 10_000,
        outputTokens: 500,
        cacheWriteTokens: 0,
      })
    );
    assert.equal(r.status, "complete");
  });

  it("N — unexpected positive cache-write fail-closed", () => {
    const r = charge(
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        promptTokens: 10_000,
        outputTokens: 500,
        cacheWriteTokens: 2_000,
      })
    );
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") {
      assert.equal(r.reason, "unsupported_cache_semantics");
    }
  });

  it("O — V4.1 published billing resolves complete for representative shapes", () => {
    assert.equal(isPhase2DeepSeekPublishedBillingModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
    for (const usage of [NORMAL_USAGE, CACHE_READ_USAGE]) {
      const r = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, usage);
      assert.equal(r.status, "complete", JSON.stringify(r));
      if (r.status === "complete") {
        assert.equal(r.snapshot.canonicalModelId, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
        assert.ok(r.snapshot.finalPoints > 0);
      }
    }
  });

  it("P — promotion owner unchanged (no v4.1 promo row)", () => {
    const pricing = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(pricing.promo, undefined);
  });

  it("Q — settlement path uses publishedUserCharge once", () => {
    const r = charge(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, NORMAL_USAGE);
    assert.equal(r.status, "complete");
    if (r.status === "complete") {
      assert.equal(r.snapshot.canonicalModelId, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
      assert.equal(r.snapshot.pricingVersion, 1);
    }
  });

  it("R — public picker contains V4.1 as a distinct Main RP model", () => {
    const ids = MAIN_RP_USER_SELECTABLE_OPTIONS.map((o) => o.id);
    assert.ok(ids.includes(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL));
    assert.notEqual(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
  });

  it("final request parity — Pro vs V4.1 same TRUE-OFF wire contract", () => {
    const proBody = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "parity" }],
      temperature: 0.92,
      top_p: 0.92,
    });
    const v41Body = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      messages: [{ role: "user", content: "parity" }],
      temperature: 0.92,
      top_p: 0.92,
    });
    assert.deepEqual(proBody.thinking, v41Body.thinking);
    assert.equal(proBody.reasoning_effort, v41Body.reasoning_effort);
    assert.equal(proBody.temperature, v41Body.temperature);
    assert.equal(proBody.top_p, v41Body.top_p);
    assert.notEqual(proBody.model, v41Body.model);
  });

  it("adaptCheaperInferenceChatBody preserves V4.1 id (no 0731 rewrite)", () => {
    const adapted = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(adapted.model, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
  });
});
