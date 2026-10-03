import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import {
  PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
  PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
} from "@/lib/modelPickerBaselineEstimate";
import { MIN_POINTS_TO_CHAT } from "@/lib/points";
import {
  computePublishedStandardPreviewDisplayPoints,
  computePublishedStandardPreviewPoints,
} from "@/lib/publishedUserCharge";
import {
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import {
  CANDIDATE_ADMISSION_MULTIPLIER,
  CANDIDATE_OPEN_OVERDRAFT_CAP_POINTS,
  TURN_ESTIMATE_OUTPUT_CHAR_FLOOR,
  buildTurnEstimateWorkload,
  computeCandidateAdmissionFloor,
  computeMainRpTurnEstimates,
  computeTurnEstimateForModel,
  estimateOutputTokensForTurn,
  turnEstimateDisplayMap,
} from "@/lib/turnEstimate";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const FX = 1560.6;

describe("turnEstimate — output floor vs last reply", () => {
  it("uses the 3,200-char production aim as the output token floor", () => {
    assert.equal(TURN_ESTIMATE_OUTPUT_CHAR_FLOOR, UNIFIED_TIER_AIM_CHARS);
    assert.equal(TURN_ESTIMATE_OUTPUT_CHAR_FLOOR, 3200);
    assert.equal(estimateOutputTokensForTurn(), Math.ceil(3200 / KOREAN_CHARS_PER_OUTPUT_TOKEN));
    assert.equal(estimateOutputTokensForTurn({ lastAssistantChars: 2000 }), 2134);
    assert.equal(estimateOutputTokensForTurn({ lastAssistantChars: 4800 }), 3200);
  });

  it("omits unverified cache discounts", () => {
    const workload = buildTurnEstimateWorkload({ promptTokens: 12_000 });
    assert.equal(workload.cacheReadTokens, 0);
    assert.equal(workload.cacheWriteTokens, 0);
    assert.equal(workload.outputTokens, 2134);
  });
});

describe("turnEstimate — Published owner only", () => {
  it("display and ceil come from publishedUserCharge, not a second price table", () => {
    const workload = buildTurnEstimateWorkload({ promptTokens: 20_000 });
    const sol = computeTurnEstimateForModel({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      workload,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(
      sol.displayPoints,
      computePublishedStandardPreviewDisplayPoints({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 20_000,
        outputTokens: 2134,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: FX,
      })
    );
    assert.equal(
      sol.chargeCeilPoints,
      computePublishedStandardPreviewPoints({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 20_000,
        outputTokens: 2134,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        effectiveKrwPerUsd: FX,
      })
    );
  });

  it("reuses the picker label suffix owner and is not wired into live chat billing", () => {
    const estimateSrc = readFileSync(join(REPO_ROOT, "src/lib/turnEstimate.ts"), "utf8");
    const pickerSrc = readFileSync(
      join(REPO_ROOT, "src/lib/modelPickerBaselineEstimate.ts"),
      "utf8"
    );
    const routeSrc = readFileSync(join(REPO_ROOT, "src/app/api/chat/route.ts"), "utf8");
    const settlementSrc = readFileSync(
      join(REPO_ROOT, "src/lib/chatBillingSettlement.ts"),
      "utf8"
    );
    assert.match(pickerSrc, /export function formatPickerBaselineEstimateSuffix/);
    assert.match(pickerSrc, / · 약 \$\{points\}P/);
    assert.doesNotMatch(estimateSrc, /약 \$\{/);
    assert.match(estimateSrc, /from "@\/lib\/publishedUserCharge"/);
    assert.doesNotMatch(routeSrc, /turnEstimate/);
    assert.doesNotMatch(settlementSrc, /turnEstimate/);
  });
});

describe("turnEstimate — candidate 3x admission vs 100P/800P", () => {
  it("100P cannot start a Sol turn whose 20k/2134 estimate already exceeds 100/3", () => {
    const sol = computeTurnEstimateForModel({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      workload: buildTurnEstimateWorkload({ promptTokens: 20_000 }),
      effectiveKrwPerUsd: FX,
    });
    assert.ok((sol.chargeCeilPoints ?? 0) > 100 / CANDIDATE_ADMISSION_MULTIPLIER);
    assert.ok((sol.candidateAdmissionFloor ?? 0) > 100);
    assert.ok((sol.candidateAdmissionFloor ?? 0) < 800);
  });

  it("keeps the 80P floor when 3x ceil is smaller", () => {
    const cheap = computeTurnEstimateForModel({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      workload: buildTurnEstimateWorkload({ promptTokens: 4_000 }),
      effectiveKrwPerUsd: FX,
    });
    assert.ok((cheap.chargeCeilPoints ?? 0) * CANDIDATE_ADMISSION_MULTIPLIER < MIN_POINTS_TO_CHAT);
    assert.equal(cheap.candidateAdmissionFloor, MIN_POINTS_TO_CHAT);
    assert.equal(computeCandidateAdmissionFloor(10), MIN_POINTS_TO_CHAT);
  });
});

describe("turnEstimate — 3x coverage table at FX 1560.6", () => {
  it("reports display/ceil/3x and whether 3x covers 2x output or +reasoning", () => {
    const rows: Array<Record<string, string | number | boolean>> = [];
    const scenarios = [
      { name: "firstish_12k", prompt: 12_000, extraOut: 0, lastChars: null as number | null },
      { name: "pickerish_20k", prompt: 20_000, extraOut: 0, lastChars: null },
      { name: "long_30k", prompt: 30_000, extraOut: 0, lastChars: null },
      { name: "last_4800chars", prompt: 20_000, extraOut: 0, lastChars: 4800 },
      { name: "2x_output", prompt: 20_000, extraOut: 2134, lastChars: null },
      { name: "plus_reasoning_2134", prompt: 20_000, extraOut: 2134, lastChars: null },
    ];

    for (const modelId of MAIN_RP_MODEL_IDS) {
      const base = computeTurnEstimateForModel({
        modelId,
        workload: buildTurnEstimateWorkload({ promptTokens: 20_000 }),
        effectiveKrwPerUsd: FX,
      });
      const twoX = computeTurnEstimateForModel({
        modelId,
        workload: buildTurnEstimateWorkload({
          promptTokens: 20_000,
          extraBillableOutputTokens: 2134,
        }),
        effectiveKrwPerUsd: FX,
      });
      const floor = base.candidateAdmissionFloor ?? 0;
      rows.push({
        modelId,
        baseline20k2134Display: base.displayPoints ?? 0,
        baselineCeil: base.chargeCeilPoints ?? 0,
        admission3x: floor,
        covers2xOutput: floor >= (twoX.chargeCeilPoints ?? Number.POSITIVE_INFINITY),
        oldPicker1500Display:
          computePublishedStandardPreviewDisplayPoints({
            modelId,
            promptTokens: PICKER_BASELINE_ESTIMATE_INPUT_TOKENS,
            outputTokens: PICKER_BASELINE_ESTIMATE_OUTPUT_TOKENS,
            effectiveKrwPerUsd: FX,
          }) ?? 0,
      });
      for (const scenario of scenarios) {
        const estimate = computeTurnEstimateForModel({
          modelId,
          workload: buildTurnEstimateWorkload({
            promptTokens: scenario.prompt,
            lastAssistantChars: scenario.lastChars,
            extraBillableOutputTokens: scenario.extraOut,
          }),
          effectiveKrwPerUsd: FX,
        });
        assert.ok(estimate.displayPoints && estimate.displayPoints > 0, `${modelId} ${scenario.name}`);
      }
    }

    const sol = rows.find((row) => row.modelId === CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    assert.ok(sol);
    assert.equal(sol.covers2xOutput, true);
    assert.ok(Number(sol.baselineCeil) > Number(sol.oldPicker1500Display));
    assert.equal(CANDIDATE_OPEN_OVERDRAFT_CAP_POINTS, 1000);

    const estimates = computeMainRpTurnEstimates({
      promptTokens: 20_000,
      effectiveKrwPerUsd: FX,
    });
    assert.equal(Object.keys(estimates).length, MAIN_RP_MODEL_IDS.length);
    const display = turnEstimateDisplayMap(estimates);
    assert.equal(display[CHEAPER_INFERENCE_GPT_61_SOL_MODEL], sol.baseline20k2134Display);
  });
});
