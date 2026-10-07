import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachNextTurnCalibrationFieldsForPersistence,
  attachProviderRequestLinkageForPersistence,
  sanitizeUsageForPublicReceipt,
  serializeUsageForPublicClient,
} from "@/lib/billingReceiptAccess";
import {
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  CHEAPER_INFERENCE_GPT_6_LUNA_MODEL,
  GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  computeMainRpNextTurnEstimates,
  firstNextTurnCalibrationRejection,
  isUsableProviderInputCalibrationSource,
} from "@/lib/mainRpNextTurnEstimate";
import { resolveMainRpProviderAdmissionRequiredPoints as admissionRequired } from "@/lib/mainRpProviderAdmission";
import { NARRATIVE_LENGTH_CONTINUATION_STAGE } from "@/lib/narrativeLengthContinuation";
import { billableOpenRouterOutputTokens } from "@/lib/points";
import { SERVER_UNDER_LENGTH_RECOVERY_STAGE } from "@/lib/serverUnderLengthRecovery";
import { applyStatusWidgetPlatformFundedExtract } from "@/lib/statusWidget/receiptUsage";
import {
  readMainRpNextTurnProviderInputCalibration,
  usageOutputTokens,
  type EstimateMessageRow,
} from "@/services/mainRpNextTurnEstimate";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const LUNA = CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
const GEMINI = GEMINI_38_FLASH_MODEL;
const FX = 1560.6;
const MAIN_IN = 14_312;
const MAIN_OUT = 2_780;
const SAVED_CHARS = 4_213;
const ASSEMBLED = 34_816;
const LUNA_IN = 2_400;
const LUNA_OUT = 180;

function mainRpInternalUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: MAIN_IN,
    output: MAIN_OUT,
    model: SOL,
    selectedAI: SOL,
    provider: "cheaperinference",
    route: "safe",
    cost: 161,
    estimated: false,
    htmlFlashOnly: false,
    apiInputTokens: MAIN_IN,
    apiOutputTokens: MAIN_OUT,
    savedOutputChars: SAVED_CHARS,
    assembledInputTokens: ASSEMBLED,
    apiCallCount: 1,
    stages: [{ stage: "primary", model: SOL, input: MAIN_IN, output: MAIN_OUT, cost: 161 }],
    adultRouting: {
      activeRoute: "general",
      actualModel: SOL,
      actualProvider: "cheaperinference",
      userSelectedModel: SOL,
      userSelectedModelLabel: "GPT-6.1 Sol",
      fallbackAttempted: false,
    },
    breakdown: [],
    ...overrides,
  };
}

function adminSharedInitialUsage(): Usage {
  return applyStatusWidgetPlatformFundedExtract(
    mainRpInternalUsage(),
    {
      inputTokens: LUNA_IN,
      outputTokens: LUNA_OUT,
      estimated: false,
    },
    resolveBillingExchangeRateSnapshot(),
    161,
    {
      modelId: LUNA,
      callCount: 1,
      postTurnSharedInitial: true,
    }
  ).record;
}

function persistNonAdmin(internal: Usage): Usage {
  return attachNextTurnCalibrationFieldsForPersistence(
    attachProviderRequestLinkageForPersistence(
      sanitizeUsageForPublicReceipt(internal),
      internal
    ),
    internal
  );
}

function calibrationInputFromUsage(usage: Usage) {
  return {
    generationStatus: "completed",
    model: usage.model,
    selectedAI: usage.selectedAI ?? null,
    actualModel: usage.adultRouting?.actualModel || usage.model || null,
    htmlFlashOnly: usage.htmlFlashOnly === true,
    estimated: usage.estimated === true,
    fallback: usage.fallback ?? null,
    fallbackAttempted: usage.adultRouting?.fallbackAttempted === true,
    apiCallCount: usage.apiCallCount ?? null,
    lengthRecoveryPasses: usage.lengthRecoveryPasses ?? null,
    stages: usage.stages ?? null,
    usageInputTokens: usage.input ?? null,
    apiInputTokens: usage.apiInputTokens ?? null,
    assembledInputTokens: usage.assembledInputTokens ?? null,
    statusWidgetExtractCallCount: usage.statusWidgetExtract?.callCount ?? null,
    statusWidgetExtractInputTokens: usage.statusWidgetExtract?.input ?? null,
  };
}

function assistantRow(usage: Usage): EstimateMessageRow {
  return {
    role: "assistant",
    content: "x".repeat(SAVED_CHARS),
    model: SOL,
    usage: JSON.stringify(usage),
    generation_status: "completed",
  };
}

function solEstimate(usage: Usage) {
  const sample = readMainRpNextTurnProviderInputCalibration([assistantRow(usage)])[SOL];
  return {
    sample: sample ?? null,
    row: computeMainRpNextTurnEstimates({
      promptTokensByModel: { [SOL]: ASSEMBLED },
      lastVisibleAssistantChars: SAVED_CHARS,
      observedCharsPerTokenByModel: { [SOL]: SAVED_CHARS / MAIN_OUT },
      providerInputCalibrationByModel: { [SOL]: sample ?? null },
      effectiveKrwPerUsd: FX,
    })[SOL],
  };
}

describe("exact admin shared-initial production shape", () => {
  it("owner-generated shape keeps visible billing 14312/2780 and aggregates Luna", () => {
    const usage = adminSharedInitialUsage();
    assert.equal(usage.input, MAIN_IN);
    assert.equal(usage.output, MAIN_OUT);
    assert.equal(usage.savedOutputChars, SAVED_CHARS);
    assert.equal(usage.assembledInputTokens, ASSEMBLED);
    assert.equal(usage.apiInputTokens, MAIN_IN + LUNA_IN);
    assert.equal(usage.apiOutputTokens, MAIN_OUT + LUNA_OUT);
    assert.ok((usage.apiInputTokens ?? 0) > MAIN_IN);
    assert.equal(usage.apiCallCount, 2);
    assert.equal(usage.statusWidgetExtract?.model, LUNA);
    assert.equal(usage.statusWidgetExtract?.callCount, 1);
    assert.equal(usage.statusWidgetExtract?.postTurnSharedInitial, true);
    assert.equal(usage.statusWidgetExtract?.input, LUNA_IN);
    assert.equal(usage.statusWidgetExtract?.output, LUNA_OUT);
    assert.equal(usage.stages?.[0]?.stage, "primary");
    assert.equal(usage.stages?.[1]?.stage, "공유 초기 (상태창 + 추천입력)");
    assert.equal(usage.stages?.[1]?.model, LUNA);
    assert.equal(usage.cost, 161);
  });

  it("1 ADMIN shared-initial uses Main RP 14312 and forecasts ~160P", () => {
    const usage = adminSharedInitialUsage();
    const input = calibrationInputFromUsage(usage);
    assert.equal(firstNextTurnCalibrationRejection(input), null);
    assert.equal(isUsableProviderInputCalibrationSource(input), true);
    const { sample, row } = solEstimate(usage);
    assert.deepEqual(sample, {
      actualBillableInputTokens: MAIN_IN,
      assembledInputTokens: ASSEMBLED,
      aggregateApiInputTokens: MAIN_IN + LUNA_IN,
      syncAuxInputTokens: LUNA_IN,
    });
    assert.ok(row);
    assert.equal(row!.calibrationSource, "same_model_billable_input_ratio");
    assert.equal(row!.actualBillableInputTokens, MAIN_IN);
    assert.equal(row!.priorAssembledInputTokens, ASSEMBLED);
    assert.equal(row!.predictedBillableInputTokens, MAIN_IN);
    assert.equal(row!.expectedOutputTokens, MAIN_OUT);
    assert.ok(row!.displayPoints >= 159 && row!.displayPoints <= 163);
    assert.notEqual(row!.displayPoints, 277);
    assert.equal(admissionRequired(row!.displayPoints), 480);
  });

  it("2 NON-ADMIN sanitized persist restores assembledInputTokens and hides them from the client", () => {
    const persisted = persistNonAdmin(mainRpInternalUsage({ apiCallCount: 2 }));
    assert.equal(persisted.assembledInputTokens, ASSEMBLED);
    assert.equal(persisted.input, MAIN_IN);
    const { sample, row } = solEstimate(persisted);
    assert.equal(sample?.actualBillableInputTokens, MAIN_IN);
    assert.ok(row);
    assert.ok(row!.displayPoints >= 159 && row!.displayPoints <= 163);
    const pub = serializeUsageForPublicClient(persisted);
    assert.equal(pub.assembledInputTokens, undefined);
    assert.equal(pub.apiCallCount, undefined);
    assert.equal(pub.adultRouting, undefined);
    assert.equal(pub.lengthRecoveryPasses, undefined);
    assert.equal(pub.statusWidgetExtract, undefined);
  });

  it("3 HTML flash auxiliary on a single Main RP stage stays usable", () => {
    const usage = mainRpInternalUsage({ apiCallCount: 2 });
    assert.equal(firstNextTurnCalibrationRejection(calibrationInputFromUsage(usage)), null);
    const { row } = solEstimate(usage);
    assert.equal(row?.calibrationSource, "same_model_billable_input_ratio");
    assert.ok((row?.displayPoints ?? 0) >= 159 && (row?.displayPoints ?? 0) <= 163);
  });

  it("4 length continuation is rejected", () => {
    const usage = mainRpInternalUsage({
      apiCallCount: 2,
      stages: [
        { stage: "primary", model: SOL, input: MAIN_IN, output: 1000, cost: 80 },
        {
          stage: NARRATIVE_LENGTH_CONTINUATION_STAGE,
          model: SOL,
          input: 8000,
          output: 1780,
          cost: 81,
        },
      ],
    });
    assert.equal(
      firstNextTurnCalibrationRejection(calibrationInputFromUsage(usage)),
      "narrative_length_continuation"
    );
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(usage)), false);
    assert.equal(solEstimate(usage).sample, null);
  });

  it("5 length recovery is rejected", () => {
    const usage = mainRpInternalUsage({
      apiCallCount: 2,
      lengthRecoveryPasses: 1,
      stages: [
        { stage: "primary", model: SOL, input: MAIN_IN, output: 400, cost: 40 },
        {
          stage: SERVER_UNDER_LENGTH_RECOVERY_STAGE,
          model: SOL,
          input: MAIN_IN,
          output: 2380,
          cost: 121,
        },
      ],
    });
    assert.equal(
      firstNextTurnCalibrationRejection(calibrationInputFromUsage(usage)),
      "length_recovery_passes"
    );
    assert.equal(solEstimate(usage).sample, null);
  });

  it("6 adult/refusal fallback is rejected", () => {
    const usage = mainRpInternalUsage({
      fallback: "adult-fallback",
      adultRouting: {
        activeRoute: "general",
        actualModel: SOL,
        actualProvider: "cheaperinference",
        userSelectedModel: SOL,
        userSelectedModelLabel: "GPT-6.1 Sol",
        fallbackAttempted: true,
      },
      stages: [
        { stage: "primary-refused", model: SOL, input: MAIN_IN, output: 20, cost: 0 },
        { stage: "fallback", model: SOL, input: MAIN_IN, output: MAIN_OUT, cost: 161 },
      ],
    });
    assert.equal(firstNextTurnCalibrationRejection(calibrationInputFromUsage(usage)), "fallback");
    assert.equal(solEstimate(usage).sample, null);
  });

  it("7 unknown/unclassified multi-call is conservatively rejected", () => {
    const missingStages = mainRpInternalUsage({ apiCallCount: 2, stages: undefined });
    delete missingStages.stages;
    assert.equal(
      firstNextTurnCalibrationRejection(calibrationInputFromUsage(missingStages)),
      "unclassified_multi_call_without_stages"
    );
    const unknownStages = mainRpInternalUsage({
      apiCallCount: 2,
      stages: [
        { stage: "primary", model: SOL, input: MAIN_IN, output: 1000, cost: 80 },
        { stage: "unknown-retry", model: SOL, input: 8000, output: 1780, cost: 81 },
      ],
    });
    assert.equal(
      firstNextTurnCalibrationRejection(calibrationInputFromUsage(unknownStages)),
      "unclassified_main_rp_multi_stage"
    );
  });

  it("8 Gemini 3.8 reasoning-separated output stays on billable output", () => {
    const raw = 4180;
    const reasoning = 1400;
    const billable = billableOpenRouterOutputTokens(GEMINI, raw, reasoning);
    assert.equal(billable, 2780);
    const usage: Usage = {
      ...mainRpInternalUsage(),
      model: GEMINI,
      selectedAI: GEMINI,
      output: billable,
      apiOutputTokens: raw,
      apiReasoningOutputTokens: reasoning,
      adultRouting: {
        activeRoute: "general",
        actualModel: GEMINI,
        actualProvider: "cheaperinference",
        userSelectedModel: GEMINI,
        userSelectedModelLabel: "Gemini 3.8 Flash",
        fallbackAttempted: false,
      },
    };
    assert.equal(usageOutputTokens(usage, GEMINI), billable);
    assert.notEqual(usage.apiOutputTokens, billable);
  });

  it("9 picker / #1400 admission stay on the same estimate owner", () => {
    const { row } = solEstimate(adminSharedInitialUsage());
    assert.ok(row);
    assert.equal(admissionRequired(row!.displayPoints), Math.max(80, row!.displayPoints * 3));
    assert.equal(admissionRequired(160), 480);
  });

  it("10 settlement stays independent of the forecast owner", () => {
    const usage = adminSharedInitialUsage();
    assert.equal(usage.cost, 161);
    const { row } = solEstimate(usage);
    assert.ok(row);
    assert.notEqual(row!.displayPoints, usage.cost);
    assert.equal(usage.input, MAIN_IN);
    assert.equal(usage.output, MAIN_OUT);
  });
});
