import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  attachNextTurnCalibrationFieldsForPersistence,
  attachProviderRequestLinkageForPersistence,
  sanitizeUsageForPublicReceipt,
  serializeUsageForPublicClient,
} from "@/lib/billingReceiptAccess";
import { CHEAPER_INFERENCE_GPT_61_SOL_MODEL } from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import {
  computeMainRpNextTurnEstimates,
  firstNextTurnCalibrationRejection,
  isUsableProviderInputCalibrationSource,
} from "@/lib/mainRpNextTurnEstimate";
import { NARRATIVE_LENGTH_CONTINUATION_STAGE } from "@/lib/narrativeLengthContinuation";
import { SERVER_UNDER_LENGTH_RECOVERY_STAGE } from "@/lib/serverUnderLengthRecovery";
import {
  readMainRpNextTurnProviderInputCalibration,
  type EstimateMessageRow,
} from "@/services/mainRpNextTurnEstimate";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const FX = 1560.6;
const API_IN = 14_312;
const API_OUT = 2_780;
const SAVED_CHARS = 4_213;
const ASSEMBLED = 34_816;
const CHAT_ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);
const ESTIMATE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/mainRpNextTurnEstimate.ts"),
  "utf8"
);

function productionInternalUsage(): Usage {
  return {
    input: API_IN,
    output: API_OUT,
    model: SOL,
    selectedAI: SOL,
    provider: "cheaperinference",
    route: "safe",
    cost: 161,
    estimated: false,
    htmlFlashOnly: false,
    apiInputTokens: API_IN,
    apiOutputTokens: API_OUT,
    savedOutputChars: SAVED_CHARS,
    assembledInputTokens: ASSEMBLED,
    apiCallCount: 2,
    stages: [{ stage: "primary", model: SOL, input: API_IN, output: API_OUT, cost: 161 }],
    adultRouting: {
      activeRoute: "general",
      actualModel: SOL,
      actualProvider: "cheaperinference",
      userSelectedModel: SOL,
      userSelectedModelLabel: "GPT-6.1 Sol",
      fallbackAttempted: false,
    },
    breakdown: [],
  };
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

function persistNonAdminBeforeFix(internal: Usage): Usage {
  return attachProviderRequestLinkageForPersistence(
    sanitizeUsageForPublicReceipt(internal),
    internal
  );
}

function calibrationInputFromUsage(
  usage: Usage,
  generationStatus = "completed"
) {
  return {
    generationStatus,
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

function rejectionMatrix(usage: Usage) {
  const input = calibrationInputFromUsage(usage);
  return [
    {
      predicate: "htmlFlashOnly !== true",
      stored: input.htmlFlashOnly,
      pass: input.htmlFlashOnly !== true,
    },
    {
      predicate: "model !== greeting",
      stored: input.model,
      pass: (input.model ?? "").trim() !== "greeting",
    },
    {
      predicate: "selectedAI !== greeting",
      stored: input.selectedAI,
      pass: (input.selectedAI ?? "").trim() !== "greeting",
    },
    {
      predicate: "successful durable generationStatus",
      stored: input.generationStatus,
      pass: input.generationStatus === "completed",
    },
    {
      predicate: "estimated !== true",
      stored: input.estimated,
      pass: input.estimated !== true,
    },
    {
      predicate: "fallback is falsy",
      stored: input.fallback,
      pass: !input.fallback,
    },
    {
      predicate: "fallbackAttempted !== true",
      stored: input.fallbackAttempted,
      pass: input.fallbackAttempted !== true,
    },
    {
      predicate: "no Main RP supplement or unclassified multi-call",
      stored: {
        apiCallCount: input.apiCallCount,
        stages: input.stages,
        lengthRecoveryPasses: input.lengthRecoveryPasses,
      },
      pass: firstNextTurnCalibrationRejection(input) == null,
      reason: firstNextTurnCalibrationRejection(input),
    },
    {
      predicate: "lengthRecoveryPasses === 0",
      stored: input.lengthRecoveryPasses,
      pass: (input.lengthRecoveryPasses ?? 0) === 0,
    },
    {
      predicate: "finite usage.input Main RP billable tokens",
      stored: input.usageInputTokens,
      pass: typeof input.usageInputTokens === "number" && input.usageInputTokens > 0,
    },
    {
      predicate: "finite assembledInputTokens",
      stored: input.assembledInputTokens,
      pass:
        typeof input.assembledInputTokens === "number" &&
        input.assembledInputTokens > 0,
    },
  ].map((row) => ({
    ...row,
    result: row.pass ? "PASS" : "FAIL",
  }));
}

function firstFail(matrix: ReturnType<typeof rejectionMatrix>) {
  return matrix.find((row) => row.result === "FAIL") ?? null;
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

function solEstimate(usage: Usage | null, assembled = ASSEMBLED) {
  const sample = usage
    ? readMainRpNextTurnProviderInputCalibration([assistantRow(usage)])[SOL]
    : undefined;
  return computeMainRpNextTurnEstimates({
    promptTokensByModel: { [SOL]: assembled },
    lastVisibleAssistantChars: SAVED_CHARS,
    observedCharsPerTokenByModel: { [SOL]: SAVED_CHARS / API_OUT },
    providerInputCalibrationByModel: { [SOL]: sample ?? null },
    effectiveKrwPerUsd: FX,
  })[SOL];
}

describe("production-shape Sol 14312/2780/4213 persist + eligibility", () => {
  it("documents the live persist owner still sanitizes then restores calibration fields", () => {
    assert.match(CHAT_ROUTE_SOURCE, /attachNextTurnCalibrationFieldsForPersistence/);
    assert.match(CHAT_ROUTE_SOURCE, /sanitizeUsageForPublicReceipt\(usageRecord\)/);
    assert.match(ESTIMATE_SOURCE, /firstNextTurnCalibrationRejection/);
    assert.doesNotMatch(ESTIMATE_SOURCE, /isHtmlFlashOnlyInflatedApiCallCount/);
    assert.doesNotMatch(ESTIMATE_SOURCE, /isMainRpMultiCallContamination/);
  });

  it("RED: pre-fix non-admin persist drops assembledInputTokens and forecasts ~277P", () => {
    const internal = productionInternalUsage();
    const persisted = persistNonAdminBeforeFix(internal);
    const matrix = rejectionMatrix(persisted);
    const fail = firstFail(matrix);
    assert.equal(persisted.assembledInputTokens, undefined);
    assert.equal(persisted.apiCallCount, undefined);
    assert.equal(persisted.adultRouting, undefined);
    assert.ok(fail);
    assert.equal(fail!.predicate, "finite assembledInputTokens");
    assert.equal(fail!.stored, null);
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(persisted)), false);
    const row = solEstimate(persisted);
    assert.ok(row);
    assert.equal(row!.calibrationSource, "uncalibrated_assembled");
    assert.equal(row!.predictedBillableInputTokens, ASSEMBLED);
    assert.equal(row!.displayPoints, 277);
  });

  it("RED: admin persist first FAIL used to be apiCallCount>1 before html-flash exception", () => {
    const admin = productionInternalUsage();
    const input = calibrationInputFromUsage(admin);
    assert.equal(input.apiCallCount, 2);
    assert.equal(input.assembledInputTokens, ASSEMBLED);
    assert.equal(input.estimated, false);
    assert.equal((input.apiCallCount ?? 1) > 1, true);
    assert.equal(firstNextTurnCalibrationRejection(input), null);
    assert.notEqual(
      firstFail(rejectionMatrix(admin))?.predicate,
      "finite assembledInputTokens"
    );
  });

  it("GREEN: non-admin persist restores assembledInputTokens and forecasts ~160P", () => {
    const internal = productionInternalUsage();
    const persisted = persistNonAdmin(internal);
    const matrix = rejectionMatrix(persisted);
    assert.equal(firstFail(matrix), null);
    assert.equal(persisted.assembledInputTokens, ASSEMBLED);
    assert.equal(persisted.apiInputTokens, API_IN);
    assert.equal(persisted.apiOutputTokens, API_OUT);
    assert.equal(persisted.savedOutputChars, SAVED_CHARS);
    assert.equal(persisted.apiCallCount, 2);
    assert.equal(persisted.adultRouting?.actualModel, SOL);
    assert.equal(persisted.adultRouting?.fallbackAttempted, false);
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(persisted)), true);
    const sample = readMainRpNextTurnProviderInputCalibration([assistantRow(persisted)])[SOL];
    assert.deepEqual(sample, {
      actualBillableInputTokens: API_IN,
      assembledInputTokens: ASSEMBLED,
      aggregateApiInputTokens: API_IN,
    });
    const row = solEstimate(persisted);
    assert.ok(row);
    assert.equal(row!.calibrationSource, "same_model_billable_input_ratio");
    assert.equal(row!.actualBillableInputTokens, API_IN);
    assert.equal(row!.priorAssembledInputTokens, ASSEMBLED);
    assert.equal(row!.predictedBillableInputTokens, API_IN);
    assert.equal(row!.expectedOutputTokens, API_OUT);
    assert.equal(row!.outputBasis, "observed_ratio");
    assert.ok(row!.displayPoints >= 159 && row!.displayPoints <= 163);
    assert.notEqual(row!.displayPoints, 277);
  });

  it("GREEN: admin html-flash-only apiCallCount=2 with one main stage is a valid sample", () => {
    const admin = productionInternalUsage();
    const matrix = rejectionMatrix(admin);
    assert.equal(firstFail(matrix), null);
    assert.equal(firstNextTurnCalibrationRejection(calibrationInputFromUsage(admin)), null);
    const row = solEstimate(admin);
    assert.equal(row?.calibrationSource, "same_model_billable_input_ratio");
    assert.ok((row?.displayPoints ?? 0) >= 159 && (row?.displayPoints ?? 0) <= 163);
  });

  it("keeps continuation/recovery/fallback multi-call rejected", () => {
    const continuation = productionInternalUsage();
    continuation.stages = [
      { stage: "primary", model: SOL, input: API_IN, output: 1000, cost: 80 },
      { stage: NARRATIVE_LENGTH_CONTINUATION_STAGE, model: SOL, input: 8000, output: 1780, cost: 81 },
    ];
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(continuation)), false);
    assert.equal(
      firstNextTurnCalibrationRejection(calibrationInputFromUsage(continuation)),
      "narrative_length_continuation"
    );

    const recovery = productionInternalUsage();
    recovery.lengthRecoveryPasses = 1;
    recovery.stages = [
      { stage: "primary", model: SOL, input: API_IN, output: 400, cost: 40 },
      { stage: SERVER_UNDER_LENGTH_RECOVERY_STAGE, model: SOL, input: API_IN, output: 2380, cost: 121 },
    ];
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(recovery)), false);

    const fallback = productionInternalUsage();
    fallback.adultRouting = {
      ...fallback.adultRouting!,
      fallbackAttempted: true,
    };
    fallback.stages = [
      { stage: "primary-refused", model: SOL, input: API_IN, output: 20, cost: 0 },
      { stage: "fallback", model: SOL, input: API_IN, output: API_OUT, cost: 161 },
    ];
    assert.equal(isUsableProviderInputCalibrationSource(calibrationInputFromUsage(fallback)), false);

    const unknownExtraCalls = productionInternalUsage();
    delete unknownExtraCalls.stages;
    assert.equal(
      isUsableProviderInputCalibrationSource(calibrationInputFromUsage(unknownExtraCalls)),
      false
    );
  });

  it("does not leak restored calibration fields to the public client", () => {
    const persisted = persistNonAdmin(productionInternalUsage());
    const pub = serializeUsageForPublicClient(persisted);
    assert.equal(pub.assembledInputTokens, undefined);
    assert.equal(pub.apiCallCount, undefined);
    assert.equal(pub.adultRouting, undefined);
    assert.equal(pub.lengthRecoveryPasses, undefined);
    assert.equal(pub.apiInputTokens, API_IN);
    assert.equal(pub.savedOutputChars, SAVED_CHARS);
  });
});
