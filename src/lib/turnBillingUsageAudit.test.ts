/**
 * CURRENT_BEHAVIOR_CHARACTERIZATION — turn billing usage + waiver contract audit.
 * These tests document existing production semantics; they are NOT desired-regression targets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import {
  OPENROUTER_GLM_52_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  isDeepSeekV4ProModel,
  isQwenModel,
  isGlmModel,
  isKimiModel,
  isMuseModel,
  isGemini36FlashModel,
  isGemini31ProModel,
} from "@/lib/chatModels";
import type { BillingWaiverReason } from "@/lib/points";
import {
  DEEPSEEK_WAIVER_SUCCESS_MIN_COST,
  QWEN_WAIVER_SUCCESS_MIN_COST,
  GLM_WAIVER_SUCCESS_MIN_COST,
  KIMI_WAIVER_SUCCESS_MIN_COST,
  MUSE_WAIVER_SUCCESS_MIN_COST,
  GEMINI_36_WAIVER_SUCCESS_MIN_COST,
  GEMINI_31_WAIVER_SUCCESS_MIN_COST,
  resolveDeepSeekWaiverMinimumCharge,
  resolveQwenWaiverMinimumCharge,
  resolveGlmWaiverMinimumCharge,
  resolveKimiWaiverMinimumCharge,
  resolveMuseWaiverMinimumCharge,
  resolveGemini36WaiverMinimumCharge,
  resolveGemini31WaiverMinimumCharge,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
  sumOpenRouterStageUpstreamUsd,
  resolveTurnBillableInput,
  shouldWaiveTurnBilling,
} from "@/lib/points";
import { isCatastrophicallyShortResponse } from "@/lib/responseLength";
import { resolveActualTurnCostCoverage } from "@/lib/shadowPricing";

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return {
    estimated: false,
    ...partial,
  };
}

/** Healthy prose — visible length >= CATASTROPHIC_MIN_RESPONSE_CHARS (80). */
const HEALTHY_LONG_PROSE =
  "가".repeat(50) +
  " 그는 조용히 고개를 들었다. 창밖의 바람이 차갑게 스쳤다. 발걸음을 옮기며 숨을 고른다. " +
  "그녀는 잠시 망설이다가 작게 미소 지었다. 긴 침묵 끝에야 비로so 입을 열었다.";

const SHORT_PROSE = "짧음";

type RouteWaiverFixture = {
  text: string;
  forcedAbort?: boolean;
  degenerationAborted?: boolean;
  generationFailure?: "under_length" | "provider_error" | null;
  usageUnavailable?: boolean;
  targetResponseChars?: number | null;
};

/** Mirrors route.ts billingWaiverReason → model minimum resolver composition (lines ~4327–4376). */
function characterizeCurrentRouteWaiver(
  modelId: string,
  fixture: RouteWaiverFixture,
  opts?: { degenerationAbortedFromStage?: boolean }
) {
  const targetResponseChars = fixture.targetResponseChars ?? null;
  const degenerationAborted = opts?.degenerationAbortedFromStage ?? fixture.degenerationAborted ?? false;
  const usageUnavailable = fixture.usageUnavailable ?? false;

  const reason = shouldWaiveTurnBilling(fixture.text, {
    forcedAbort: fixture.forcedAbort ?? false,
    degenerationAborted,
    generationFailure: fixture.generationFailure ?? null,
    usageUnavailable,
    adultMode: true,
    targetResponseChars,
  });

  if (!reason) {
    return {
      reason: null as BillingWaiverReason | null,
      waiverApplied: false,
      minimumResolverCalled: false,
      waiverMinimum: 0,
      finalCostSemantic: "NORMAL_FULL_BILLING" as const,
    };
  }

  const resolverOpts = { degenerationAborted, targetResponseChars };
  let waiverMinimum = 0;
  if (isDeepSeekV4ProModel(modelId)) {
    waiverMinimum = resolveDeepSeekWaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isQwenModel(modelId)) {
    waiverMinimum = resolveQwenWaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isGlmModel(modelId)) {
    waiverMinimum = resolveGlmWaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isKimiModel(modelId)) {
    waiverMinimum = resolveKimiWaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isMuseModel(modelId)) {
    waiverMinimum = resolveMuseWaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isGemini36FlashModel(modelId)) {
    waiverMinimum = resolveGemini36WaiverMinimumCharge(fixture.text, reason, resolverOpts);
  } else if (isGemini31ProModel(modelId)) {
    waiverMinimum = resolveGemini31WaiverMinimumCharge(fixture.text, reason, resolverOpts);
  }

  return {
    reason,
    waiverApplied: true,
    minimumResolverCalled: true,
    waiverMinimum,
    finalCostSemantic: (waiverMinimum > 0 ? "MINIMUM_FLOOR" : "FULL_WAIVER_0P") as
      | "MINIMUM_FLOOR"
      | "FULL_WAIVER_0P",
  };
}

const MODEL_FIXTURES = [
  { label: "DeepSeek", modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, constant: DEEPSEEK_WAIVER_SUCCESS_MIN_COST },
  { label: "Qwen", modelId: OPENROUTER_QWEN_37_MAX_MODEL, constant: QWEN_WAIVER_SUCCESS_MIN_COST },
  { label: "GLM", modelId: OPENROUTER_GLM_52_MODEL, constant: GLM_WAIVER_SUCCESS_MIN_COST },
  { label: "Kimi", modelId: OPENROUTER_KIMI_K3_MODEL, constant: KIMI_WAIVER_SUCCESS_MIN_COST },
  { label: "Muse", modelId: OPENROUTER_MUSE_SPARK_11_MODEL, constant: MUSE_WAIVER_SUCCESS_MIN_COST },
  { label: "Gemini36", modelId: OPENROUTER_GEMINI_36_FLASH_MODEL, constant: GEMINI_36_WAIVER_SUCCESS_MIN_COST },
  { label: "Gemini31", modelId: OPENROUTER_GEMINI_31_PRO_MODEL, constant: GEMINI_31_WAIVER_SUCCESS_MIN_COST },
] as const;

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — selectBillableStages", () => {
  it("normal single-stage selects first only", () => {
    const stages = [
      stage({ stage: "primary", model: "anthropic/claude-opus-4.5", input: 1000, output: 500 }),
    ];
    const billable = selectBillableStages(stages);
    assert.equal(billable.length, 1);
    assert.equal(billable[0]?.stage, "primary");
  });

  it("refusal fallback delivered selects last stage", () => {
    const stages = [
      stage({ stage: "primary-refused", model: "google/gemini-3.7-flash", input: 800, output: 100 }),
      stage({ stage: "fallback", model: "deepseek/deepseek-chat", input: 1200, output: 400 }),
    ];
    const billable = selectBillableStages(stages, { refusalFallbackDelivered: true });
    assert.equal(billable.length, 1);
    assert.equal(billable[0]?.stage, "fallback");
    assert.equal(billable[0]?.input, 1200);
  });

  it("multi-stage default keeps primary for input ownership", () => {
    const stages = [
      stage({ stage: "primary", model: "anthropic/claude-opus-4.5", input: 5000, output: 1000, apiOutputTokens: 1000 }),
      stage({
        stage: "narrative-length-continuation",
        model: "anthropic/claude-opus-4.5",
        input: 6000,
        output: 800,
        apiOutputTokens: 800,
      }),
    ];
    const billable = selectBillableStages(stages);
    assert.equal(billable[0]?.input, 5000);
    assert.equal(sumOpenRouterStageOutputTokens(stages), 1800);
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — primary vs aggregate mixing", () => {
  it("input from primary stage, output aggregated across stages (route pattern)", () => {
    const stages = [
      stage({
        stage: "primary",
        model: "anthropic/claude-opus-4.5",
        input: 10_000,
        output: 1500,
        apiOutputTokens: 1500,
        cacheReadTokens: 2000,
        standardInputTokens: 8000,
      }),
      stage({
        stage: "server-under-length-recovery",
        model: "anthropic/claude-opus-4.5",
        input: 12_000,
        output: 900,
        apiOutputTokens: 900,
      }),
    ];
    const billable = selectBillableStages(stages);
    const primary = billable[0]!;
    const totalInput = resolveTurnBillableInput({ stageInput: primary.input });
    const totalOutput = sumOpenRouterStageOutputTokens(stages);
    const totalReasoning = sumOpenRouterStageReasoningTokens(stages);
    const cacheRead = primary.cacheReadTokens ?? 0;

    assert.equal(totalInput, 10_000);
    assert.equal(totalOutput, 2400);
    assert.equal(totalReasoning, 0);
    assert.equal(cacheRead, 2000);
    assert.notEqual(totalInput, stages[0]!.input + stages[1]!.input);
  });
});

describe("LOW_LEVEL_HELPER_CHARACTERIZATION — isolated minimum resolver", () => {
  it("manual forced_abort + long healthy text can return nonzero (NOT route-reachable)", () => {
    const min = resolveDeepSeekWaiverMinimumCharge(HEALTHY_LONG_PROSE, "forced_abort");
    assert.equal(min, DEEPSEEK_WAIVER_SUCCESS_MIN_COST);
    assert.ok(min > 0);
  });

  it("verified minimum constants from @/lib/points owner chain", () => {
    assert.equal(DEEPSEEK_WAIVER_SUCCESS_MIN_COST, 20);
    assert.equal(QWEN_WAIVER_SUCCESS_MIN_COST, 50);
    assert.equal(GLM_WAIVER_SUCCESS_MIN_COST, 50);
    assert.equal(KIMI_WAIVER_SUCCESS_MIN_COST, 65);
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
    assert.equal(GEMINI_36_WAIVER_SUCCESS_MIN_COST, 50);
    assert.equal(GEMINI_31_WAIVER_SUCCESS_MIN_COST, 65);
  });
});

describe("CURRENT_ROUTE_COMPOSITION_CHARACTERIZATION — waiver path", () => {
  it("A — forced abort + healthy long output → no waiver, normal full billing", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
      text: HEALTHY_LONG_PROSE,
      forcedAbort: true,
    });
    assert.equal(result.reason, null);
    assert.equal(result.waiverApplied, false);
    assert.equal(result.minimumResolverCalled, false);
    assert.equal(result.finalCostSemantic, "NORMAL_FULL_BILLING");
  });

  it("B — forced abort + catastrophically short → forced_abort waiver, minimum stays 0", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_QWEN_37_MAX_MODEL, {
      text: SHORT_PROSE,
      forcedAbort: true,
    });
    assert.equal(result.reason, "forced_abort");
    assert.equal(result.waiverMinimum, 0);
    assert.equal(result.finalCostSemantic, "FULL_WAIVER_0P");
  });

  it("C — forced abort + degenerate long text → garbage_output, minimum 0", () => {
    const degenerate = "asdf ".repeat(40);
    const result = characterizeCurrentRouteWaiver(OPENROUTER_GLM_52_MODEL, {
      text: degenerate,
      forcedAbort: true,
    });
    assert.equal(result.reason, "garbage_output");
    assert.equal(result.waiverMinimum, 0);
  });

  it("D — degenerationAborted → degeneration, minimum 0", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_KIMI_K3_MODEL, {
      text: HEALTHY_LONG_PROSE,
      degenerationAborted: true,
    });
    assert.equal(result.reason, "degeneration");
    assert.equal(result.waiverMinimum, 0);
  });

  it("E — generationFailure → generation_failure, minimum 0", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_MUSE_SPARK_11_MODEL, {
      text: HEALTHY_LONG_PROSE,
      generationFailure: "under_length",
    });
    assert.equal(result.reason, "generation_failure");
    assert.equal(result.waiverMinimum, 0);
  });

  it("F — usageUnavailable → generation_failure, minimum 0", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_GEMINI_36_FLASH_MODEL, {
      text: HEALTHY_LONG_PROSE,
      usageUnavailable: true,
    });
    assert.equal(result.reason, "generation_failure");
    assert.equal(result.waiverMinimum, 0);
  });

  it("G — catastrophically short without forcedAbort → generation_failure, minimum 0", () => {
    const result = characterizeCurrentRouteWaiver(OPENROUTER_GEMINI_31_PRO_MODEL, {
      text: SHORT_PROSE,
    });
    assert.equal(result.reason, "generation_failure");
    assert.equal(result.waiverMinimum, 0);
  });

  it("H — garbage output without forcedAbort → garbage_output, minimum 0", () => {
    const degenerate = "asdf ".repeat(40);
    const result = characterizeCurrentRouteWaiver(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, {
      text: degenerate,
    });
    assert.equal(result.reason, "garbage_output");
    assert.equal(result.waiverMinimum, 0);
  });
});

describe("CURRENT_ROUTE_COMPOSITION_CHARACTERIZATION — all seven models", () => {
  const reachableFixtures: RouteWaiverFixture[] = [
    { text: SHORT_PROSE, forcedAbort: true },
    { text: HEALTHY_LONG_PROSE, degenerationAborted: true },
    { text: HEALTHY_LONG_PROSE, generationFailure: "under_length" },
    { text: HEALTHY_LONG_PROSE, usageUnavailable: true },
    { text: SHORT_PROSE },
    { text: "asdf ".repeat(40) },
    { text: "asdf ".repeat(40), forcedAbort: true },
  ];

  for (const model of MODEL_FIXTURES) {
    it(`${model.label} — reachable waiver reasons always produce minimum 0 through route composition`, () => {
      for (const fixture of reachableFixtures) {
        const result = characterizeCurrentRouteWaiver(model.modelId, fixture);
        if (result.reason != null) {
          assert.equal(
            result.waiverMinimum,
            0,
            `${model.label} reason=${result.reason} fixture=${JSON.stringify(fixture)}`
          );
        }
      }
    });
  }

  it("CAN_ROUTE_WAIVER_MINIMUM_EVER_BE_GREATER_THAN_ZERO — false across all models and fixtures", () => {
    let anyNonZero = false;
    for (const model of MODEL_FIXTURES) {
      for (const fixture of reachableFixtures) {
        const result = characterizeCurrentRouteWaiver(model.modelId, fixture);
        if (result.waiverMinimum > 0) anyNonZero = true;
      }
      // Also test healthy + forcedAbort (no waiver — resolver not called)
      const healthyForced = characterizeCurrentRouteWaiver(model.modelId, {
        text: HEALTHY_LONG_PROSE,
        forcedAbort: true,
      });
      assert.equal(healthyForced.minimumResolverCalled, false);
    }
    assert.equal(anyNonZero, false);
  });
});

describe("CURRENT_ROUTE_COMPOSITION_CHARACTERIZATION — forced_abort invariant", () => {
  it("forced_abort from shouldWaive implies catastrophic short; minimum returns 0 with same target", () => {
    const target = 1200;
    const text = SHORT_PROSE;
    const reason = shouldWaiveTurnBilling(text, {
      forcedAbort: true,
      adultMode: true,
      targetResponseChars: target,
    });
    assert.equal(reason, "forced_abort");
    assert.equal(isCatastrophicallyShortResponse(text, target), true);
    assert.equal(
      resolveDeepSeekWaiverMinimumCharge(text, reason!, { targetResponseChars: target }),
      0
    );
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — actual cost coverage (shadow)", () => {
  it("multi-stage marks partial coverage", () => {
    assert.equal(resolveActualTurnCostCoverage({ totalStageCount: 2 }), "partial");
  });

  it("fallback attempted marks partial coverage", () => {
    assert.equal(
      resolveActualTurnCostCoverage({ totalStageCount: 1, fallbackAttempted: true }),
      "partial"
    );
  });

  it("single successful stage marks complete", () => {
    assert.equal(resolveActualTurnCostCoverage({ totalStageCount: 1 }), "complete");
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — upstream aggregation", () => {
  it("sumOpenRouterStageUpstreamUsd aggregates all non-Gemini stages", () => {
    const stages = [
      stage({
        stage: "primary",
        model: "anthropic/claude-opus-4.5",
        input: 1000,
        output: 500,
        upstreamCostUsd: 0.05,
      }),
      stage({
        stage: "continuation",
        model: "anthropic/claude-opus-4.5",
        input: 2000,
        output: 300,
        upstreamCostUsd: 0.02,
      }),
    ];
    assert.equal(sumOpenRouterStageUpstreamUsd(stages), 0.07);
  });
});
