import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
} from "@/lib/chatModels";
import {
  applyNextTurnInputForecast,
  computeMainRpNextTurnEstimates,
  isPreviousAssistantRetainedInHistory,
  resolveNextTurnHistoryDelta,
} from "@/lib/mainRpNextTurnEstimate";
import { resolveMainRpProviderAdmissionRequiredPoints } from "@/lib/mainRpProviderAdmission";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FLASH = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
const FX = 1560.6;
const TURN_N_IN = 14_312;
const TURN_N_OUT = 2_780;
const TURN_N_CHARS = 4_213;
const TURN_N_ASSEMBLED = 34_816;
const TURN_N1_IN = 17_104;
const TURN_N1_OUT = 2_726;
const TURN_N1_SETTLED = 174;
const USER_DELTA = 12;

function formerRatioPrediction(nextAssembled: number): number {
  return Math.max(1, Math.round(nextAssembled * (TURN_N_IN / TURN_N_ASSEMBLED)));
}

function sequentialDelta(overrides: Partial<Parameters<typeof resolveNextTurnHistoryDelta>[0]> = {}) {
  return resolveNextTurnHistoryDelta({
    previous: {
      actualBillableInputTokens: TURN_N_IN,
      actualBillableOutputTokens: TURN_N_OUT,
      assembledInputTokens: TURN_N_ASSEMBLED,
    },
    previousAssistantRetained: true,
    currentUserEstimatedTokens: 0,
    ...overrides,
  });
}

function solRow(input: {
  assembled?: number;
  delta?: ReturnType<typeof sequentialDelta> | null;
  outputChars?: number;
  outputTokens?: number;
}) {
  const delta = input.delta === undefined ? sequentialDelta() : input.delta;
  return computeMainRpNextTurnEstimates({
    promptTokensByModel: { [SOL]: input.assembled ?? TURN_N_ASSEMBLED },
    lastVisibleAssistantChars: input.outputChars ?? TURN_N_CHARS,
    observedCharsPerTokenByModel: {
      [SOL]: (input.outputChars ?? TURN_N_CHARS) / (input.outputTokens ?? TURN_N_OUT),
    },
    providerInputCalibrationByModel: {
      [SOL]: {
        actualBillableInputTokens: TURN_N_IN,
        actualBillableOutputTokens: TURN_N_OUT,
        assembledInputTokens: TURN_N_ASSEMBLED,
      },
    },
    historyDeltaByModel: { [SOL]: delta },
    effectiveKrwPerUsd: FX,
  })[SOL];
}

describe("sequential Sol actual-anchored input delta", () => {
  it("A RED: former whole-prompt ratio underpredicts 17104 / 174P", () => {
    assert.equal(TURN_N1_IN - TURN_N_IN, TURN_N_OUT + USER_DELTA);
    assert.equal(formerRatioPrediction(TURN_N_ASSEMBLED), TURN_N_IN);
    assert.equal(formerRatioPrediction(TURN_N_ASSEMBLED + TURN_N_OUT), 15_455);
    assert.ok(formerRatioPrediction(TURN_N_ASSEMBLED) < TURN_N1_IN);
    const at155 = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: 13_410,
      outputTokens: TURN_N_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(at155, 155);
    const sameAssembled = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: TURN_N_IN,
      outputTokens: TURN_N_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(sameAssembled, 160);
    assert.ok((sameAssembled ?? 0) < TURN_N1_SETTLED);
  });

  it("A GREEN: retained previous output + 12-token user delta lands near 17104 / 174P", () => {
    const send = solRow({
      delta: sequentialDelta({ currentUserEstimatedTokens: USER_DELTA }),
    });
    assert.ok(send);
    assert.equal(send!.forecastSource, "same_model_actual_anchored_delta");
    assert.equal(send!.predictedBillableInputTokens, TURN_N1_IN);
    assert.equal(send!.expectedOutputTokens, TURN_N_OUT);
    assert.ok(Math.abs(send!.displayPoints - TURN_N1_SETTLED) <= 5);
    const actualCharge = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: TURN_N1_IN,
      outputTokens: TURN_N1_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(actualCharge, TURN_N1_SETTLED);
  });

  it("B no summary boundary keeps previous output in next input", () => {
    const picker = solRow({});
    assert.equal(picker?.retainedNewHistoryTokens, TURN_N_OUT);
    assert.equal(picker?.predictedBillableInputTokens, TURN_N_IN + TURN_N_OUT);
    assert.equal(picker?.previousRawHistoryState, "raw_retained");
    assert.equal(picker?.nextRawHistoryState, "raw_retained");
    assert.equal(
      isPreviousAssistantRetainedInHistory({
        previousAssistantContent: "kept assistant",
        nextPromptHistory: [
          { role: "user", content: "next" },
          { role: "assistant", content: "kept assistant" },
        ],
      }),
      true
    );
  });

  it("C RAW eviction subtracts removed context", () => {
    const evicted = solRow({
      delta: sequentialDelta({
        removedHistoryTokens: 2_000,
        evictedMessageTexts: ["x".repeat(100)],
      }),
    });
    assert.equal(evicted?.predictedBillableInputTokens, TURN_N_IN + TURN_N_OUT - 2_000);
    assert.equal(evicted?.nextRawHistoryState, "raw_evicted");
  });

  it("D rolling-summary boundary may decrease input", () => {
    const compacted = solRow({
      delta: sequentialDelta({
        previous: {
          actualBillableInputTokens: TURN_N_IN,
          actualBillableOutputTokens: TURN_N_OUT,
          rawHistoryHealth: { summarizedThroughTurn: 0, rawCompleteExchanges: 5 },
        },
        nextRawHistoryHealth: { summarizedThroughTurn: 5, rawCompleteExchanges: 4 },
        removedHistoryTokens: 3_000,
      }),
    });
    assert.equal(compacted?.nextRawHistoryState, "summary_compacted");
    assert.ok((compacted?.predictedBillableInputTokens ?? 0) < TURN_N_IN + TURN_N_OUT);
  });

  it("E/F lorebook and persona/user-note changes are context deltas", () => {
    const loreOn = solRow({
      delta: sequentialDelta({ contextDeltaTokens: 400 }),
    });
    const loreOff = solRow({
      delta: sequentialDelta({ contextDeltaTokens: -400 }),
    });
    assert.equal(loreOn?.predictedBillableInputTokens, TURN_N_IN + TURN_N_OUT + 400);
    assert.equal(loreOff?.predictedBillableInputTokens, TURN_N_IN + TURN_N_OUT - 400);
  });

  it("G/H contaminated anchors stay rejected and do not apply delta", () => {
    const uncalibrated = applyNextTurnInputForecast({
      localAssembledInputTokens: TURN_N_ASSEMBLED,
    });
    assert.equal(uncalibrated.forecastSource, "uncalibrated_assembled");
    assert.equal(uncalibrated.predictedBillableInputTokens, TURN_N_ASSEMBLED);
  });

  it("I model switch does not reuse the Sol anchor", () => {
    const flash = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [FLASH]: 7_000 },
      providerInputCalibrationByModel: {
        [SOL]: {
          actualBillableInputTokens: TURN_N_IN,
          actualBillableOutputTokens: TURN_N_OUT,
        },
      },
      historyDeltaByModel: { [SOL]: sequentialDelta() },
      effectiveKrwPerUsd: FX,
    })[FLASH];
    assert.ok(flash);
    assert.equal(flash!.forecastSource, "uncalibrated_assembled");
    assert.equal(flash!.predictedBillableInputTokens, 7_000);
  });

  it("J no prior sample uses the explicit assembled fallback", () => {
    const row = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [SOL]: TURN_N_ASSEMBLED },
      lastVisibleAssistantChars: TURN_N_CHARS,
      observedCharsPerTokenByModel: { [SOL]: TURN_N_CHARS / TURN_N_OUT },
      effectiveKrwPerUsd: FX,
    })[SOL];
    assert.equal(row?.forecastSource, "uncalibrated_assembled");
    assert.equal(row?.predictedBillableInputTokens, TURN_N_ASSEMBLED);
    assert.equal(row?.displayPoints, 277);
  });

  it("K picker/admission are the same owner with different current-user data", () => {
    const picker = solRow({ delta: sequentialDelta({ currentUserEstimatedTokens: 0 }) });
    const admit = solRow({
      delta: sequentialDelta({ currentUserEstimatedTokens: USER_DELTA }),
    });
    assert.equal(picker?.forecastSource, admit?.forecastSource);
    assert.equal(picker?.predictedBillableInputTokens, TURN_N_IN + TURN_N_OUT);
    assert.equal(admit?.predictedBillableInputTokens, TURN_N1_IN);
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(admit!.displayPoints), Math.max(80, admit!.displayPoints * 3));
  });

  it("L settlement stays independent of the forecast owner", () => {
    const row = solRow({
      delta: sequentialDelta({ currentUserEstimatedTokens: USER_DELTA }),
    });
    assert.notEqual(row?.displayPoints, TURN_N1_SETTLED + 80);
    assert.ok(Math.abs((row?.displayPoints ?? 0) - TURN_N1_SETTLED) <= 5);
  });
});
