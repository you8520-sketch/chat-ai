import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  applyNextTurnInputForecast,
  isImmediatePreviousSameModelActualAnchor,
} from "@/lib/mainRpNextTurnEstimate";
import { estimateTokensFromCharCount } from "@/lib/tokenEstimate";

/**
 * Numeric evidence only. These are stored usage ratios, not a prompt replay
 * and not a license to invent a per-model coefficient.
 */
const RECORDED = [
  {
    label: "gemini-one-sample",
    localAssembled: 18_721,
    apiInputTokens: 18_512,
    assembledChars: 20_799,
  },
  {
    label: "sol-sample-1",
    localAssembled: 35_656,
    apiInputTokens: 22_496,
    assembledChars: 39_615,
  },
  {
    label: "sol-sample-2",
    localAssembled: 39_518,
    apiInputTokens: 24_973,
    assembledChars: 43_905,
  },
] as const;

const SHARED_LOCAL = 41_959;
const SOL_ANCHOR_INPUT = 17_104;

function relativeError(local: number, actual: number): number {
  return (local - actual) / actual;
}

describe("main RP picker estimate accuracy fixture", () => {
  it("keeps chars×0.9 and the recorded local-vs-api gaps unchanged", () => {
    assert.equal(estimateTokensFromCharCount(100), 90);
    for (const sample of RECORDED) {
      const wholeStringEstimate = estimateTokensFromCharCount(sample.assembledChars);
      assert.ok(Math.abs(sample.localAssembled - wholeStringEstimate) <= 4);
    }
    const [gemini, solA, solB] = RECORDED;
    assert.ok(Math.abs(relativeError(gemini.localAssembled, gemini.apiInputTokens)) < 0.02);
    assert.ok(relativeError(solA.localAssembled, solA.apiInputTokens) > 0.5);
    assert.ok(relativeError(solB.localAssembled, solB.apiInputTokens) > 0.5);
    const solScale = solA.apiInputTokens / solA.localAssembled;
    assert.notEqual(
      Math.round(gemini.localAssembled * solScale),
      gemini.localAssembled
    );
    assert.equal(
      applyNextTurnInputForecast({
        localAssembledInputTokens: gemini.localAssembled,
      }).predictedBillableInputTokens,
      gemini.localAssembled
    );
  });

  it("anchors only the same model and leaves first-use models on the local assembly", () => {
    const historyDelta = {
      previousAssistantRetained: true,
      retainedNewHistoryTokens: 1_500,
      removedHistoryTokens: 0,
      contextDeltaTokens: 0,
      currentUserEstimatedTokens: 411,
      previousRawHistoryState: "raw_retained" as const,
      nextRawHistoryState: "raw_retained" as const,
    };
    const sol = applyNextTurnInputForecast({
      localAssembledInputTokens: SHARED_LOCAL,
      previous: {
        actualBillableInputTokens: SOL_ANCHOR_INPUT,
        actualBillableOutputTokens: 2_000,
      },
      historyDelta,
    });
    assert.equal(sol.forecastSource, "same_model_actual_anchored_delta");
    assert.equal(sol.calibrationConfidence, "latest_same_model");
    assert.equal(
      sol.predictedBillableInputTokens,
      SOL_ANCHOR_INPUT + 1_500 + 411
    );
    assert.notEqual(sol.predictedBillableInputTokens, SHARED_LOCAL);

    const uncalibrated = applyNextTurnInputForecast({
      localAssembledInputTokens: SHARED_LOCAL,
    });
    assert.equal(uncalibrated.forecastSource, "uncalibrated_assembled");
    assert.equal(uncalibrated.predictedBillableInputTokens, SHARED_LOCAL);
    const borrowed = Math.round(
      SHARED_LOCAL * (RECORDED[1].apiInputTokens / RECORDED[1].localAssembled)
    );
    assert.notEqual(uncalibrated.predictedBillableInputTokens, borrowed);

    const solTurn = {
      identity: { rowKey: "sol-turn", modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL },
      usableSample: {
        actualBillableInputTokens: SOL_ANCHOR_INPUT,
        actualBillableOutputTokens: 2_000,
      },
    };
    assert.equal(
      isImmediatePreviousSameModelActualAnchor({
        forecastModelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        immediatePrevious: solTurn,
        candidateIdentity: solTurn.identity,
      }),
      true
    );
    for (const modelId of [
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    ]) {
      assert.equal(
        isImmediatePreviousSameModelActualAnchor({
          forecastModelId: modelId,
          immediatePrevious: solTurn,
          candidateIdentity: solTurn.identity,
        }),
        false
      );
    }
  });
});
