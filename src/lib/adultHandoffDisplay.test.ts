import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_HANDOFF_HINT,
  ADULT_HANDOFF_NOTICE,
  ADULT_HANDOFF_POINTS_HINT,
  ADULT_HANDOFF_REASON,
  isAdultHandoffDisplayTurn,
  modelSupportsAdultHandoffNotice,
  publicAdultHandoffCopyIsSafe,
  resolveAdultHandoffReceiptLines,
  selectedModelIdentityIsStable,
  toPublicAdultHandoffRouting,
} from "@/lib/adultHandoffDisplay";
import {
  buildBillingReceipt,
  formatBillingReceiptText,
} from "@/lib/billingDisplay";
import {
  sanitizeUsageForPublicReceipt,
  stripAdultRoutingForClient,
} from "@/lib/billingReceiptAccess";
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
  QWEN_38_MAX_DISPLAY_NAME,
  selectedAILabel,
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
    fallbackAttempted: false,
    fallbackSucceeded: false,
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
    model: input.selected,
    modelLabel: input.selectedLabel,
    selectedAI: input.selected,
    provider: "cheaperinference",
    route: "nsfw",
    cost: input.cost,
    breakdown: [],
    stages: [
      { stage: "adult", model: input.actual, input: 100, output: 50, cost: input.cost },
    ],
    adultRouting: adultRouting(input),
  };
}

describe("adult handoff display — selected vs actual", () => {
  it("CASE A: Opus normal keeps a single selected-model receipt line", () => {
    const usage: Usage = {
      input: 10,
      output: 20,
      model: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      modelLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      selectedAI: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      route: "safe",
      cost: 80,
      breakdown: [],
    };
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    const receipt = buildBillingReceipt(sanitized);
    assert.ok(receipt);
    assert.equal(receipt.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.equal(sanitized.adultRouting, undefined);
    const text = formatBillingReceiptText(receipt, {
      adultHandoff: resolveAdultHandoffReceiptLines(sanitized),
    });
    assert.match(text, new RegExp(`모델: ${CLAUDE_OPUS_5_DISPLAY_NAME}`));
    assert.doesNotMatch(text, /선택 모델:/);
    assert.doesNotMatch(text, /실제 처리:/);
    assert.equal(receipt.totalCost, 80);
  });

  it("CASE B: Opus adult → Qwen keeps picker identity and shows receipt actual", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    assert.equal(
      selectedModelIdentityIsStable(
        publicUsage,
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        CLAUDE_OPUS_5_DISPLAY_NAME
      ),
      true
    );
    assert.notEqual(publicUsage.selectedAI, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    const lines = resolveAdultHandoffReceiptLines(publicUsage);
    assert.deepEqual(lines, {
      selectedModelLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actualModelLabel: QWEN_38_MAX_DISPLAY_NAME,
      reason: ADULT_HANDOFF_REASON,
    });
    const receipt = buildBillingReceipt(publicUsage);
    assert.ok(receipt);
    assert.equal(receipt.totalCost, 12);
    assert.equal(receipt.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    const text = formatBillingReceiptText(receipt, { adultHandoff: lines });
    assert.match(text, /선택 모델: Claude Opus 5/);
    assert.match(text, /실제 처리: Qwen 3.8 Max/);
    assert.match(text, /사유: 성인 장면 호환/);
    assert.equal(publicUsage.adultRouting?.glmHardFailureReason, undefined);
    assert.equal(publicUsage.adultRouting?.hiddenFallbackOverheadCostUsd, undefined);
  });

  it("CASE C: sticky adult Qwen still shows Opus in selected identity", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 15,
      extras: { routeTriggerReason: "sticky_adult" },
    });
    const publicUsage = sanitizeUsageForPublicReceipt(usage);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(publicUsage.adultRouting?.actualModel, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    assert.equal(resolveAdultHandoffReceiptLines(publicUsage)?.actualModelLabel, QWEN_38_MAX_DISPLAY_NAME);
  });

  it("CASE D: scene end / source return has no handoff receipt lines or toast copy", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      cost: 80,
      activeRoute: "general",
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(publicUsage.adultRouting, undefined);
    assert.equal(resolveAdultHandoffReceiptLines(publicUsage), null);
    assert.equal(ADULT_HANDOFF_NOTICE.includes("전환되었습니다"), false);
    assert.equal(ADULT_HANDOFF_HINT.includes("Qwen"), false);
  });

  it("CASE E: Gemini 3.1 adult → Qwen", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      selectedLabel: GEMINI_31_PRO_PREVIEW_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 14,
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    const lines = resolveAdultHandoffReceiptLines(publicUsage);
    assert.equal(lines?.selectedModelLabel, GEMINI_31_PRO_PREVIEW_DISPLAY_NAME);
    assert.equal(lines?.actualModelLabel, QWEN_38_MAX_DISPLAY_NAME);
    assert.equal(lines?.reason, ADULT_HANDOFF_REASON);
  });

  it("CASE F: Gemini 3.7 adult → DeepSeek", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      selectedLabel: GEMINI_37_FLASH_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      cost: 9,
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    assert.equal(publicUsage.selectedAI, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    const lines = resolveAdultHandoffReceiptLines(publicUsage);
    assert.equal(lines?.selectedModelLabel, GEMINI_37_FLASH_DISPLAY_NAME);
    assert.equal(lines?.actualModelLabel, DEEPSEEK_DISPLAY_NAME);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), "DeepSeek V4 Pro");
  });

  it("CASE G: transient Opus OOC is the same one-turn display rule", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 11,
      extras: { routeTriggerReason: "transient_ooc_anatomy" },
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    assert.equal(publicUsage.modelLabel, CLAUDE_OPUS_5_DISPLAY_NAME);
    assert.equal(publicUsage.adultRouting?.actualModel, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    assert.equal(publicUsage.adultRouting?.routeTriggerReason, undefined);
  });

  it("CASE H: Qwen hard-fail → DeepSeek success shows DeepSeek as actual, hides fallback internals", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      cost: 10,
      extras: {
        glmHardFailureFallbackAttempted: true,
        glmHardFailureFallbackSucceeded: true,
        glmHardFailureReason: "qwen_timeout",
      },
    });
    const publicUsage = stripAdultRoutingForClient(usage);
    const lines = resolveAdultHandoffReceiptLines(publicUsage);
    assert.equal(lines?.actualModelLabel, DEEPSEEK_DISPLAY_NAME);
    assert.equal(publicUsage.adultRouting?.glmHardFailureFallbackSucceeded, undefined);
    assert.equal(publicUsage.adultRouting?.glmHardFailureReason, undefined);
    assert.equal(publicUsage.stages?.[0]?.model, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(publicUsage.stages?.[0]?.stage, "main");
  });

  it("CASE I: normal non-handoff receipt text stays identical", () => {
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
    const before = [
      `모델: ${receipt.modelLabel}`,
      `입력/출력 토큰: ${receipt.inputTokens.toLocaleString()} / ${receipt.outputTokens.toLocaleString()}`,
      `포인트 차감: ${receipt.totalCost} P`,
    ].join("\n");
    const after = formatBillingReceiptText(receipt, {
      adultHandoff: resolveAdultHandoffReceiptLines(usage),
    });
    assert.equal(after, before);
  });

  it("CASE J: admin/debug keeps actualModel, actualProvider, selectedModel, and fallback internals", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      cost: 10,
    });
    const adminUsage = stripAdultRoutingForClient(usage, { keepInternal: true });
    assert.equal(adminUsage.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(adminUsage.adultRouting?.actualModel, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(adminUsage.adultRouting?.actualProvider, "cheaperinference");
    assert.equal(adminUsage.adultRouting?.userSelectedModel, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(adminUsage.adultRouting?.glmHardFailureFallbackSucceeded, true);
    assert.equal(adminUsage.adultRouting?.glmHardFailureReason, "qwen_hard_fail");
    assert.equal(adminUsage.stages?.[0]?.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });

  it("does not recompute billing from the selected model", () => {
    const usage = usageWith({
      selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
      actual: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      cost: 12,
    });
    const publicUsage = sanitizeUsageForPublicReceipt(usage);
    const receipt = buildBillingReceipt(publicUsage);
    assert.equal(receipt?.totalCost, 12);
    assert.notEqual(receipt?.totalCost, 80);
  });

  it("picker notice is limited to Opus / Gemini 3.1 / Gemini 3.7 and never names Qwen", () => {
    assert.equal(modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
    assert.equal(
      modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL),
      true
    );
    assert.equal(modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), true);
    assert.equal(modelSupportsAdultHandoffNotice(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), false);
    assert.equal(ADULT_HANDOFF_NOTICE.includes("Qwen"), false);
    assert.equal(ADULT_HANDOFF_HINT.includes("Qwen"), false);
    assert.equal(ADULT_HANDOFF_POINTS_HINT.includes("Qwen"), false);
    assert.equal(publicAdultHandoffCopyIsSafe(ADULT_HANDOFF_NOTICE), true);
    assert.equal(publicAdultHandoffCopyIsSafe(ADULT_HANDOFF_HINT), true);
    assert.equal(publicAdultHandoffCopyIsSafe(ADULT_HANDOFF_REASON), true);
  });

  it("serializeVariantsForClient keeps the public subset and can keep admin internals", () => {
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
    assert.equal(
      publicPayload.variants[0]?.usage?.adultRouting?.actualModel,
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(
      publicPayload.variants[0]?.usage?.adultRouting?.glmHardFailureReason,
      undefined
    );
    const adminPayload = serializeVariantsForClient(variants, 0, {
      keepInternalAdultRouting: true,
    });
    assert.equal(
      adminPayload.variants[0]?.usage?.adultRouting?.glmHardFailureReason,
      "qwen_hard_fail"
    );
    assert.equal(variants[0]?.usage?.adultRouting?.glmHardFailureReason, "qwen_hard_fail");
  });

  it("general-route adultRouting is not a display handoff", () => {
    assert.equal(
      isAdultHandoffDisplayTurn(
        adultRouting({
          selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
          actual: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          activeRoute: "general",
        })
      ),
      false
    );
    assert.equal(
      toPublicAdultHandoffRouting(
        adultRouting({
          selected: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          selectedLabel: CLAUDE_OPUS_5_DISPLAY_NAME,
          actual: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
          activeRoute: "adult",
        })
      ),
      undefined
    );
  });
});
