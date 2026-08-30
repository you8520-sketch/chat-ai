import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_HANDOFF_HINT,
  ADULT_HANDOFF_NOTICE,
  modelSupportsAdultHandoffNotice,
  publicAdultHandoffCopyIsSafe,
  selectedModelIdentityIsStable,
} from "@/lib/adultHandoffDisplay";
import {
  buildBillingReceipt,
  formatBillingReceiptText,
} from "@/lib/billingDisplay";
import {
  serializeUsageForPublicClient,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
import { assertNoInternalEconomics } from "@/lib/publicUsageEconomicsBoundary";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  CLAUDE_OPUS_5_DISPLAY_NAME,
  DEEPSEEK_DISPLAY_NAME,
  GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
  GEMINI_37_FLASH_DISPLAY_NAME,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import { serializeVariantsForClient, type MessageVariant } from "@/lib/messageAlternates";

function adultRouting(input: {
  selected: string;
  selectedLabel: string;
  actual: string;
  actualProvider?: string;
  activeRoute?: "general" | "adult";
  extras?: Partial<NonNullable<Usage["adultRouting"]>>;
}): NonNullable<Usage["adultRouting"]> {
  return {
    activeRoute: input.activeRoute ?? "adult",
    sceneModeBefore: "explicit",
    sceneModeAfter: "explicit",
    requestedModel: input.selected,
    actualModel: input.actual,
    actualProvider: input.actualProvider ?? "cheaperinference",
    userSelectedModel: input.selected,
    userSelectedModelLabel: input.selectedLabel,
    userSelectedProvider: "cheaperinference",
    fallbackAttempted: true,
    fallbackSucceeded: true,
    glmHardFailureFallbackAttempted: true,
    glmHardFailureFallbackSucceeded: true,
    glmHardFailureReason: "qwen_hard_fail",
    hiddenFallbackOverheadCostUsd: 0.01,
    userChargedPoints: 12,
    ...input.extras,
  };
}

function usageWith(input: {
  selected: string;
  selectedLabel: string;
  actual: string;
  cost: number;
  activeRoute?: "general" | "adult";
  extras?: Partial<NonNullable<Usage["adultRouting"]>>;
}): Usage {
  return {
    input: 100,
    output: 50,
    model: input.actual,
    modelLabel: input.actual,
    selectedAI: input.actual,
    provider: "cheaperinference",
    route: "nsfw",
    cost: input.cost,
    breakdown: [
      { label: "최근 RAW 턴", tokens: 40, pct: 40 },
      { label: "캐릭터 프롬프트", tokens: 30, pct: 30 },
      { label: "장기 기억(현재 기억)", tokens: 10, pct: 10 },
      { label: "선택 페르소나", tokens: 10, pct: 10 },
      { label: "활성화 로어북", tokens: 10, pct: 10 },
    ],
    stages: [
      { stage: "adult", model: input.actual, input: 100, output: 50, cost: input.cost },
    ],
    adultRouting: adultRouting(input),
    upstreamCostUsd: 0.02,
    apiRawCostKrw: 30,
    mainApiRawCostKrw: 28,
    exchangeRateKrwPerUsd: 1400,
  };
}

describe("adult handoff display — public field freeze", () => {
  it("1. public usage field kinds stay the existing receipt set", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const publicUsage = serializeUsageForPublicClient(usage);
    assertNoInternalEconomics(publicUsage, "handoff-1");
    assert.equal(publicUsage.input, 100);
    assert.equal(publicUsage.output, 50);
    assert.equal(publicUsage.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.deepEqual(
      publicUsage.breakdown.map((row) => row.label),
      ["최근 RAW 턴", "캐릭터 프롬프트", "장기 기억(현재 기억)", "선택 페르소나", "활성화 로어북"]
    );
    const receipt = buildBillingReceipt(publicUsage);
    assert.ok(receipt);
    const text = formatBillingReceiptText(receipt);
    assert.match(text, /모델: Claude Opus 5/);
    assert.doesNotMatch(text, /선택 모델:/);
    assert.doesNotMatch(text, /실제 처리:/);
    assert.doesNotMatch(text, /사유:/);
    assert.doesNotMatch(text, /Qwen/);
  });

  it("2. public clients never receive margin/raw/upstream/provider/fallback diagnostics", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const publicUsage = serializeUsageForPublicClient(usage);
    assert.equal(publicUsage.adultRouting, undefined);
    assertNoInternalEconomics(publicUsage, "handoff-2");
    const receipt = buildBillingReceipt(publicUsage);
    assert.ok(receipt);
    const text = formatBillingReceiptText(receipt);
    assert.doesNotMatch(text, /마진율|원가|upstream|actualProvider|fallback|Qwen|DeepSeek/);
  });

  it("3. admin/debug keeps full adultRouting metadata", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      cost: 10,
    });
    const adminUsage = serializeUsageForPublicClient(usage, { keepInternal: true });
    assert.equal(adminUsage.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(adminUsage.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.equal(adminUsage.adultRouting?.actualModel, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(adminUsage.adultRouting?.actualProvider, "cheaperinference");
    assert.equal(adminUsage.adultRouting?.userSelectedModel, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(adminUsage.adultRouting?.fallbackSucceeded, true);
    assert.equal(adminUsage.adultRouting?.glmHardFailureReason, "qwen_hard_fail");
    assert.equal(adminUsage.adultRouting?.hiddenFallbackOverheadCostUsd, 0.01);
  });

  it("4. Opus → Qwen public 사용 모델 stays Claude Opus 5", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const publicUsage = serializeUsageForPublicClient(usage);
    assert.equal(
      selectedModelIdentityIsStable(
        publicUsage,
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        CLAUDE_OPUS_5_DISPLAY_NAME
      ),
      true
    );
    assert.equal(publicUsage.adultRouting, undefined);
    assertNoInternalEconomics(publicUsage, "handoff-4");
    assert.equal(buildBillingReceipt(publicUsage)?.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.equal(publicUsage.cost, 12);
  });

  it("5. Gemini 3.1 → Qwen public 사용 모델 stays Gemini 3.1", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      selectedLabel: GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 14,
    });
    const publicUsage = serializeUsageForPublicClient(usage);
    assert.equal(publicUsage.modelLabel, GEMINI_31_PRO_PREVIEW_DISPLAY_NAME);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.equal(publicUsage.adultRouting, undefined);
    assertNoInternalEconomics(publicUsage, "handoff-5");
    assert.equal(publicUsage.cost, 14);
  });

  it("6. Gemini 3.7 → DeepSeek public 사용 모델 stays Gemini 3.7", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      selectedLabel: GEMINI_37_FLASH_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      cost: 9,
    });
    const publicUsage = serializeUsageForPublicClient(usage);
    assert.equal(publicUsage.modelLabel, GEMINI_37_FLASH_DISPLAY_NAME);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(publicUsage.adultRouting, undefined);
    assertNoInternalEconomics(publicUsage, "handoff-6");
    assert.equal(publicUsage.cost, 9);
  });

  it("7. billing cost stays on the delivered model, not the selected label", () => {
    const qwenTurn = serializeUsageForPublicClient(
      usageWith({
        selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
        actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
        cost: 12,
      })
    );
    const deepseekTurn = serializeUsageForPublicClient(
      usageWith({
        selected: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        selectedLabel: GEMINI_37_FLASH_DISPLAY_NAME,
        actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        cost: 9,
      })
    );
    assert.equal(buildBillingReceipt(qwenTurn)?.totalCost, 12);
    assert.equal(buildBillingReceipt(deepseekTurn)?.totalCost, 9);
    assert.notEqual(qwenTurn.cost, 80);
  });

  it("8. normal non-handoff receipt text stays identical", () => {
    const usage: Usage = {
      input: 8,
      output: 16,
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      modelLabel: DEEPSEEK_DISPLAY_NAME,
      selectedAI: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      route: "safe",
      cost: 5,
      breakdown: [],
    };
    const receipt = buildBillingReceipt(usage);
    assert.ok(receipt);
    const expected = [
      `모델: ${receipt.modelLabel}`,
      `입력/출력 토큰: ${receipt.inputTokens.toLocaleString()} / ${receipt.outputTokens.toLocaleString()}`,
      `포인트 차감: ${receipt.totalCost} P`,
    ].join("\n");
    assert.equal(formatBillingReceiptText(receipt), expected);
    assert.equal(serializeUsageForPublicClient(usage).adultRouting, undefined);
  });

  it("picker notice never names Qwen/DeepSeek or margin/cost internals", () => {
    assert.equal(modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
    assert.equal(
      modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), true);
    assert.equal(publicAdultHandoffCopyIsSafe(ADULT_HANDOFF_NOTICE), true);
    assert.equal(publicAdultHandoffCopyIsSafe(ADULT_HANDOFF_HINT), true);
    assert.match(ADULT_HANDOFF_NOTICE, /호환 모델이 자동으로 사용될 수 있으며/);
    assert.match(ADULT_HANDOFF_NOTICE, /실제 사용 모델 기준으로 포인트가 계산됩니다/);
  });

  it("serializeVariantsForClient strips adultRouting for public and keeps it for admin", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const variants: MessageVariant[] = [
      { content: "hi", model: usage.model, usage, created_at: "t" },
    ];
    const publicPayload = serializeVariantsForClient(variants, 0);
    assert.equal(publicPayload.variants[0]?.usage?.adultRouting, undefined);
    assert.equal(publicPayload.variants[0]?.usage?.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assertNoInternalEconomics(publicPayload.variants[0]!.usage!, "handoff-variant-public");
    const adminPayload = serializeVariantsForClient(variants, 0, {
      keepInternalAdultRouting: true,
    });
    assert.equal(
      adminPayload.variants[0]?.usage?.adultRouting?.actualModel,
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
  });
});

describe("stripAdultRoutingForClient — routing identity only", () => {
  it("ROUTING_HELPER_REMOVES_OR_REWRITES_ROUTING_METADATA=true", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const routingOnly = stripAdultRoutingForClient(usage);
    assert.equal(routingOnly.adultRouting, undefined);
    assert.equal(routingOnly.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.equal(routingOnly.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
  });

  it("ROUTING_HELPER_OWNS_ECONOMICS_PRIVACY=false", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const routingOnly = stripAdultRoutingForClient(usage);
    assert.equal(routingOnly.apiRawCostKrw, 30);
    assert.equal(routingOnly.upstreamCostUsd, 0.02);
    assert.equal(routingOnly.exchangeRateKrwPerUsd, 1400);
  });
});
