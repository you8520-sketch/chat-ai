import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as points from "@/lib/points";
import {
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterDeepSeekTurnCost,
  explainOpenRouterGemini31TurnCost,
  explainOpenRouterGemini37TurnCost,
  isIncompleteStreamUsageUnavailable,
  resolveGemini37FlashFinalUserCharge,
  shouldWaiveTurnBilling,
} from "@/lib/points";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  isCheaperInferenceGemini37FlashModel,
} from "@/lib/chatModels";
import { buildBillingReceipt, formatBillingReceiptText } from "@/lib/billingDisplay";

describe("Gemini 3.7 Flash billing hook", () => {
  const modelId = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;

  it("uses the exact Cheaper Inference detector only", () => {
    assert.equal(isCheaperInferenceGemini37FlashModel(modelId), true);
    assert.equal(isCheaperInferenceGemini37FlashModel("google/gemini-3.7-flash"), false);
    assert.equal(isCheaperInferenceGemini37FlashModel(OPENROUTER_GEMINI_36_FLASH_MODEL), false);
    assert.equal(
      isCheaperInferenceGemini37FlashModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      false
    );
  });

  it("competitor fixture 22947 / 3897 => 60P via computeOpenRouterTurnCost", () => {
    assert.equal(computeOpenRouterTurnCost(22_947, 3_897, modelId), 60);
  });

  it("locks the required V2 example price table", () => {
    assert.equal(computeOpenRouterTurnCost(20_000, 2_000, modelId), 35);
    assert.equal(computeOpenRouterTurnCost(30_000, 3_000, modelId), 61);
    assert.equal(computeOpenRouterTurnCost(40_000, 3_000, modelId), 62);
    assert.equal(computeOpenRouterTurnCost(50_000, 3_000, modelId), 63);
    assert.equal(computeOpenRouterTurnCost(53_823, 4_444, modelId), 68);
    assert.equal(computeOpenRouterTurnCost(70_000, 4_000, modelId), 65);
    assert.equal(computeOpenRouterTurnCost(100_000, 6_000, modelId), 83);
  });

  it("same input/output cold vs warm => same 63P user price", () => {
    const inputTokens = 50_000;
    const outputTokens = 3_000;
    const cold = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      upstreamCostUsd: 0.12,
      apiPromptTokens: inputTokens,
      apiCompletionTokens: outputTokens,
      userContextChars: 12_000,
    });
    const warm = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 0,
      upstreamCostUsd: 0.02,
      apiPromptTokens: inputTokens,
      apiCompletionTokens: outputTokens,
      userContextChars: 12_000,
    });
    assert.equal(cold.total, 63);
    assert.equal(warm.total, 63);
    assert.equal(cold.contextSurcharge, 0);
    assert.equal(warm.contextSurcharge, 0);
    assert.equal(cold.gemini37FlashPricing?.totalPoints, 63);
    assert.equal(warm.gemini37FlashPricing?.totalPoints, 63);
  });

  it("failed/waived output stays 0P and has no 3.7 base floor", () => {
    const waived = shouldWaiveTurnBilling("asdf", { degenerationAborted: true });
    assert.equal(waived, "degeneration");
    const failure = shouldWaiveTurnBilling("", { generationFailure: "under_length" });
    assert.equal(failure, "generation_failure");
    const forced = shouldWaiveTurnBilling("", { forcedAbort: true });
    assert.ok(forced === "forced_abort" || forced === "generation_failure" || forced === "garbage_output");
    const charge = waived ? 0 : computeOpenRouterTurnCost(50_000, 3_000, modelId);
    assert.equal(charge, 0);
    assert.equal("resolveGemini37WaiverMinimumCharge" in points, false);
    assert.equal("resolveGemini37FlashWaiverMinimumCharge" in points, false);
  });

  it("keeps Gemini 3.1 Pro billing unchanged", () => {
    const inputTokens = 22_947;
    const outputTokens = 3_897;
    const openRouter31 = computeOpenRouterTurnCost(
      inputTokens,
      outputTokens,
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    const cheaper31 = computeOpenRouterTurnCost(
      inputTokens,
      outputTokens,
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
    assert.equal(
      openRouter31,
      explainOpenRouterGemini31TurnCost(
        inputTokens,
        outputTokens,
        OPENROUTER_GEMINI_31_PRO_MODEL
      ).total
    );
    assert.notEqual(openRouter31, 60);
    assert.notEqual(cheaper31, 60);
    assert.equal(isCheaperInferenceGemini37FlashModel(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.equal(
      isCheaperInferenceGemini37FlashModel(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      false
    );
  });

  it("keeps DeepSeek V4 Pro billing unchanged", () => {
    const inputTokens = 22_947;
    const outputTokens = 3_897;
    const deepSeek = computeOpenRouterTurnCost(
      inputTokens,
      outputTokens,
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      deepSeek,
      explainOpenRouterDeepSeekTurnCost(
        inputTokens,
        outputTokens,
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL
      ).total
    );
    assert.notEqual(deepSeek, 60);
  });

  it("keeps Opus billing unchanged", () => {
    const opus = computeOpenRouterTurnCost(
      50_000,
      3_000,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      undefined,
      { outputChars: 2_500 }
    );
    const gemini37 = computeOpenRouterTurnCost(50_000, 3_000, modelId);
    assert.equal(gemini37, 63);
    assert.notEqual(opus, 63);
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: 50_000,
      outputTokens: 3_000,
      outputChars: 2_500,
    });
    assert.equal(billing.gemini37FlashPricing, undefined);
    assert.equal(billing.total, opus);
  });

  it("admin explain keeps cache/upstream off the user total", () => {
    const cold = explainOpenRouterGemini37TurnCost(
      50_000,
      3_000,
      modelId,
      { cacheReadTokens: 0, cacheWriteTokens: 0 },
      { upstreamCostUsd: 0.12, apiPromptTokens: 50_000, apiCompletionTokens: 3_000 }
    );
    const warm = explainOpenRouterGemini37TurnCost(
      50_000,
      3_000,
      modelId,
      { cacheReadTokens: 40_000, cacheWriteTokens: 0 },
      { upstreamCostUsd: 0.02, apiPromptTokens: 50_000, apiCompletionTokens: 3_000 }
    );
    assert.equal(cold.total, 63);
    assert.equal(warm.total, 63);
    assert.ok(cold.rawCostKrw > warm.rawCostKrw);
  });

  it("public receipt stays model / tokens / points; admin copy adds the 3.7 breakdown", () => {
    const usage = {
      cost: 68,
      apiInputTokens: 53_823,
      apiOutputTokens: 4_444,
      modelLabel: "Gemini 3.7 Flash",
      model: modelId,
      provider: "cheaperinference" as const,
      gemini37FlashPricing: {
        basePoints: 35,
        inputTokens: 53_823,
        inputSurchargePoints: 3,
        billedOutputTokens: 4_444,
        outputSurchargePoints: 30,
        totalPoints: 68,
      },
    };
    const receipt = buildBillingReceipt(usage);
    assert.ok(receipt);
    assert.equal(receipt!.modelLabel, "Gemini 3.7 Flash");
    assert.equal(receipt!.inputTokens, 53_823);
    assert.equal(receipt!.outputTokens, 4_444);
    assert.equal(receipt!.totalCost, 68);
    assert.equal(receipt!.hasSurcharge, false);
    const publicLike = `모델: ${receipt!.modelLabel}\n입력/출력 토큰: ${receipt!.inputTokens.toLocaleString()} / ${receipt!.outputTokens.toLocaleString()}\n포인트 차감: ${receipt!.totalCost}P`;
    assert.match(publicLike, /모델: Gemini 3\.7 Flash/);
    assert.match(publicLike, /53,823 \/ 4,444/);
    assert.match(publicLike, /68P/);
    const admin = formatBillingReceiptText(receipt!, {
      gemini37FlashPricing: usage.gemini37FlashPricing,
    });
    assert.match(admin, /Gemini 3\.7 pricing:/);
    assert.match(admin, /base: 35P/);
    assert.match(admin, /input surcharge: 3P/);
    assert.match(admin, /output surcharge: 30P/);
    assert.match(admin, /main charge: 68P/);
  });

  it("finish=null + usage=0 incomplete stream => final user charge 0P", () => {
    const partial =
      "라이크는 복도 끝에서 걸음을 늦추며 렌 쪽을 돌아보았다. 전자 초커가 짧게 울렸고, 그 이상은 스트림이 끊겼다. ".repeat(
        8
      );
    assert.ok(partial.length > 80);
    assert.equal(
      isIncompleteStreamUsageUnavailable({
        finishReason: null,
        promptTokens: 0,
        completionTokens: 0,
      }),
      true
    );
    const owner = resolveGemini37FlashFinalUserCharge({
      inputTokens: 0,
      billedOutputTokens: 0,
      finishReason: null,
      promptTokens: 0,
      completionTokens: 0,
      savedText: partial,
    });
    assert.equal(owner.computedPoints, 35);
    assert.equal(owner.waiverReason, "generation_failure");
    assert.equal(owner.finalUserPoints, 0);
    const wouldDeduct = owner.finalUserPoints > 0 ? owner.finalUserPoints : 0;
    assert.equal(wouldDeduct, 0);
  });
});
