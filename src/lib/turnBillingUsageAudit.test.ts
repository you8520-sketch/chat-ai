/**
 * CURRENT_BEHAVIOR_CHARACTERIZATION — turn billing usage + waiver contract audit.
 * These tests document existing production semantics; they are NOT desired-regression targets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import {
  resolveDeepSeekWaiverMinimumCharge,
  resolveQwenWaiverMinimumCharge,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
  sumOpenRouterStageUpstreamUsd,
  resolveTurnBillableInput,
  shouldWaiveTurnBilling,
} from "@/lib/points";
import { resolveActualTurnCostCoverage } from "@/lib/shadowPricing";

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return {
    estimated: false,
    ...partial,
  };
}

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
    // Recovery stage input is NOT included in live billable input today.
    assert.notEqual(totalInput, stages[0]!.input + stages[1]!.input);
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — waiver + minimum charge", () => {
  // Must exceed CATASTROPHIC_MIN_RESPONSE_CHARS (80) for minimum-charge path.
  const meaningfulProse =
    "그는 천천히 고개를 들었다. 조용한 실내에 발소리만 울렸고, 창밖으로 희미한 빛이 스며들었다. " +
    "그녀는 잠시 망설이다가 작게 미소 지었다. 긴 침묵 끝에야 비로소 입을 열었다. ";

  it("shouldWaiveTurnBilling — degeneration always waives", () => {
    assert.equal(
      shouldWaiveTurnBilling(meaningfulProse, { degenerationAborted: true, adultMode: true }),
      "degeneration"
    );
  });

  it("shouldWaiveTurnBilling — forced abort with long healthy text does NOT waive (current behavior)", () => {
    assert.equal(
      shouldWaiveTurnBilling(meaningfulProse, { forcedAbort: true, adultMode: true }),
      null
    );
  });

  it("shouldWaiveTurnBilling — forced abort with catastrophically short text waives", () => {
    assert.equal(
      shouldWaiveTurnBilling("짧음", { forcedAbort: true, adultMode: true }),
      "forced_abort"
    );
  });

  it("minimum charge requires visible text >= catastrophic floor (80 chars)", () => {
    const short = "유의미한 본문.";
    assert.equal(resolveDeepSeekWaiverMinimumCharge(short, "forced_abort"), 0);
    const min = resolveDeepSeekWaiverMinimumCharge(meaningfulProse, "forced_abort");
    assert.equal(min, 20);
    assert.equal(resolveDeepSeekWaiverMinimumCharge(meaningfulProse, "degeneration"), 0);
    assert.equal(resolveDeepSeekWaiverMinimumCharge("", "forced_abort"), 0);
  });

  it("model minimum resolvers share algorithm — different constants only", () => {
    const qwenMin = resolveQwenWaiverMinimumCharge(meaningfulProse, "forced_abort");
    const deepseekMin = resolveDeepSeekWaiverMinimumCharge(meaningfulProse, "forced_abort");
    assert.equal(qwenMin, 50);
    assert.equal(deepseekMin, 20);
    assert.equal(resolveQwenWaiverMinimumCharge(meaningfulProse, "generation_failure"), 0);
  });
});

describe("CURRENT_BEHAVIOR_CHARACTERIZATION — actual cost coverage (shadow)", () => {
  it("multi-stage marks partial coverage", () => {
    assert.equal(
      resolveActualTurnCostCoverage({ totalStageCount: 2 }),
      "partial"
    );
  });

  it("fallback attempted marks partial coverage", () => {
    assert.equal(
      resolveActualTurnCostCoverage({ totalStageCount: 1, fallbackAttempted: true }),
      "partial"
    );
  });

  it("single successful stage marks complete", () => {
    assert.equal(
      resolveActualTurnCostCoverage({ totalStageCount: 1 }),
      "complete"
    );
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
