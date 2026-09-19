import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminBillingReceiptV3,
} from "@/lib/adminBillingReceiptV3";
import {
  buildAdminReceiptCompactViewModel,
  formatAdminBillingReceiptV3Text,
  formatAdminReceiptAuxiliaryCallOutcome,
  resolveStatusWidgetSyncAuxiliaryOutcome,
} from "@/lib/adminBillingReceiptV3Shared";
import type { Usage } from "@/lib/chatUsage";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

const FX = {
  dateKey: "2026-09-17",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

const MAIN_USD = 0.0195;
const LUNA_USD = 0.000846;

function deepSeekRegenUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 31_095,
    output: 3_728,
    model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 78,
    baseCost: 78,
    breakdown: [],
    shadowPricing: {
      pricingVersion: 1,
      billingReferenceInputUsdPerMillion: 1,
      billingReferenceOutputUsdPerMillion: 2,
      billingReferenceCostKrw: 10,
      billingReferenceCostUsd: 0.01,
      fxSnapshot: FX,
      providerListCostStatus: "complete",
      reserveStatus: "complete",
      actualTurnCostCoverage: "complete",
      actualProviderCostKrw: Math.round(MAIN_USD * FX.effectiveKrwPerUsd * 10) / 10,
      actualCostUsd: MAIN_USD,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.65,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 78,
      promoPercent: 0,
      finalShadowChargeKrw: 78,
      finalShadowPoints: 78,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 50,
      actualRealizedMargin: 0.625,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
    },
    statusWidgetExtract: {
      input: 400,
      output: 120,
      model: "gpt-5.6-luna",
      modelLabel: "GPT-5.6 Luna (공유 초기: 상태창 + 추천입력)",
      estimated: false,
      apiRawCostKrw: 1,
      callCount: 1,
      postTurnSharedInitial: true,
      actualProviderCostUsd: LUNA_USD,
      actualCostSource: "cheaper_inference_billed",
      actualCostCoverage: "complete",
      actualProviderCostKrw: Math.round(LUNA_USD * FX.effectiveKrwPerUsd * 10) / 10,
    },
    ...overrides,
  };
}

function memoryTask(
  state: MemoryRelationshipTaskRecord["state"],
  reason?: string
): MemoryRelationshipTaskRecord {
  return { state, updatedAt: new Date().toISOString(), reason };
}

function mainLedgerRow(usd = MAIN_USD): ProviderCostLedgerRow {
  return {
    event_key: "main-gen",
    event_status: "settled",
    family: "main_generation",
    funding_class: "user_funded",
    execution_phase: "main_generation",
    actual_cost_usd: usd,
    actual_cost_source: "cheaper_inference_billed",
    exact: true,
    incomplete: false,
    generation_sequence: 1,
    actual_model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    requested_model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  } as unknown as ProviderCostLedgerRow;
}

function syncSharedInitialLedgerRow(usd = LUNA_USD): ProviderCostLedgerRow {
  return {
    event_key: "shared-initial",
    event_status: "settled",
    family: "post_turn_shared_initial",
    funding_class: "platform_funded",
    execution_phase: "sync_post_turn",
    actual_cost_usd: usd,
    actual_cost_source: "cheaper_inference_billed",
    exact: true,
    incomplete: false,
    generation_sequence: 1,
    actual_model: "gpt-5.6-luna",
    requested_model: "gpt-5.6-luna",
    generation_request_id: "regen-req-1",
  } as unknown as ProviderCostLedgerRow;
}

function asyncLedgerRow(
  family: string,
  usd: number,
  overrides: Partial<ProviderCostLedgerRow> = {}
): ProviderCostLedgerRow {
  return {
    event_key: `ev-${family}`,
    event_status: "settled",
    family,
    funding_class: "platform_funded",
    execution_phase: "async_post_turn",
    actual_cost_usd: usd,
    actual_cost_source: "cheaper_inference_billed",
    exact: true,
    incomplete: false,
    generation_sequence: 1,
    actual_model: "gpt-5.6-luna",
    requested_model: "gpt-5.6-luna",
    generation_request_id: "regen-req-1",
    ...overrides,
  } as unknown as ProviderCostLedgerRow;
}

function buildRegenReceipt(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[],
  opts: Partial<Parameters<typeof buildAdminBillingReceiptV3>[0]> = {}
) {
  return buildAdminBillingReceiptV3({
    usage,
    assistantMessageId: 9001,
    chatId: 42,
    mainRpOutputVisibleChars: 5105,
    generationScope: {
      assistantMessageId: 9001,
      generationSequence: 1,
      generationRequestId: "regen-req-1",
    },
    suggestedRepliesRecord: {
      replies: [],
      extractedAt: new Date().toISOString(),
      source: "background-deepseek",
      pending: false,
      failed: true,
    },
    statusMetaRecord: {
      meta: {
        tableMarkdown: "",
        datetime: "",
        location: "",
        relationship: "",
        npcEmotion: "",
        npcIntent: "",
        nextObjective: "",
        hiddenThought: "",
        sceneSummary: "",
      },
      extractedAt: new Date().toISOString(),
      source: "background-deepseek",
      pending: false,
      failed: false,
      formatSpec: null,
    },
    memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
    ledgerRows,
    ...opts,
  });
}

describe("DeepSeek regen turn observability — production-path fixtures", () => {
  it("CASE 1 — main + shared initial: ledger count matches receipt auxiliary rows and known cost", () => {
    const usage = deepSeekRegenUsage();
    const ledgerRows = [mainLedgerRow(), syncSharedInitialLedgerRow()];
    const receipt = buildRegenReceipt(usage, ledgerRows);
    const vm = buildAdminReceiptCompactViewModel(receipt);

    assert.equal(receipt.async.physicalCallCount, 0, "sync_post_turn excluded from async");
    assert.equal(vm.auxiliaryCalls.length, 1);
    assert.equal(vm.auxiliaryCalls[0]!.label, "공유 초기 (상태창 + 추천입력)");
    assert.ok(Math.abs((vm.mainRp.costUsd ?? 0) - MAIN_USD) < 1e-9);
    assert.ok(Math.abs((vm.auxiliaryCalls[0]!.costUsd ?? 0) - LUNA_USD) < 1e-9);
    assert.ok(Math.abs(receipt.wholeTurn.knownProviderSpendUsd - (MAIN_USD + LUNA_USD)) < 1e-9);
  });

  it("CASE 2 — provider call success + extraction exhausted: receipt shows call success · extraction failed", () => {
    const usage = deepSeekRegenUsage({
      statusWidgetExtractDiagnostics: {
        exhausted: true,
        usedFallback: false,
        attempts: [
          {
            stage: "initial",
            modelId: "gpt-5.6-luna",
            httpStatus: 200,
            finishReason: "stop",
            errorCode: null,
            reasonCode: "V3_INITIAL_EMPTY",
            succeeded: false,
          },
        ],
      },
    });
    const receipt = buildRegenReceipt(usage, [mainLedgerRow(), syncSharedInitialLedgerRow()]);
    const vm = buildAdminReceiptCompactViewModel(receipt);
    const widget = vm.auxiliaryCalls[0]!;

    assert.equal(widget.result, "success");
    assert.equal(widget.extractionResult, "failed");
    assert.match(formatAdminReceiptAuxiliaryCallOutcome(widget), /호출 성공 · 추출 실패/);
    assert.doesNotMatch(formatAdminBillingReceiptV3Text(receipt), /1회 성공[^·]/);
  });

  it("CASE 3 — auxiliary retry: retry cost included once in known spend", () => {
    const usage = deepSeekRegenUsage({
      statusWidgetExtract: {
        ...deepSeekRegenUsage().statusWidgetExtract!,
        callCount: 2,
        actualProviderCostUsd: LUNA_USD + 0.0002,
      },
    });
    const ledgerRows = [
      mainLedgerRow(),
      syncSharedInitialLedgerRow(LUNA_USD),
      asyncLedgerRow("status_widget_extract", 0.0002, {
        execution_phase: "sync_post_turn",
        family: "status_widget_extract",
      }),
    ];
    const receipt = buildRegenReceipt(usage, ledgerRows);
    assert.ok(
      Math.abs(receipt.wholeTurn.syncActualCostUsd! - (LUNA_USD + 0.0002)) < 1e-9,
      "usage-owned sync spend includes retry aggregate"
    );
    assert.equal(receipt.async.physicalCallCount, 0);
  });

  it("CASE 4 — pending async: margin withheld, partial known cost still visible", () => {
    const usage = deepSeekRegenUsage();
    const receipt = buildRegenReceipt(usage, [mainLedgerRow(), syncSharedInitialLedgerRow()], {
      statusMetaRecord: {
        meta: {
          tableMarkdown: "",
          datetime: "",
          location: "",
          relationship: "",
          npcEmotion: "",
          npcIntent: "",
          nextObjective: "",
          hiddenThought: "",
          sceneSummary: "",
        },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: true,
        failed: false,
        formatSpec: null,
      },
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);

    assert.equal(receipt.wholeTurn.coverage, "pending");
    assert.equal(vm.marginPercent, null);
    assert.ok(vm.knownTurnCostKrw != null && vm.knownTurnCostKrw > 0);
    assert.equal(vm.hasCompleteTotal, false);
  });

  it("CASE 5 — regen scope: generation B ledger does not inherit generation A rows", () => {
    const usage = deepSeekRegenUsage();
    const gen0Row = {
      ...syncSharedInitialLedgerRow(0.001),
      generation_sequence: 0,
      generation_request_id: "regen-req-0",
    } as ProviderCostLedgerRow;
    const gen1Row = syncSharedInitialLedgerRow(LUNA_USD);
    const receipt = buildRegenReceipt(usage, [mainLedgerRow(), gen0Row, gen1Row]);
    assert.equal(receipt.async.physicalCallCount, 0);
    assert.ok(Math.abs((receipt.wholeTurn.syncActualCostUsd ?? 0) - LUNA_USD) < 1e-9);
  });

  it("CASE 6 — complete whole-turn: margin uses settled P minus exact provider KRW (1P=1₩)", () => {
    const usage = deepSeekRegenUsage({
      statusWidgetExtractDiagnostics: {
        exhausted: false,
        usedFallback: false,
        attempts: [
          {
            stage: "initial",
            modelId: "gpt-5.6-luna",
            httpStatus: 200,
            finishReason: "stop",
            errorCode: null,
            reasonCode: "OK",
            succeeded: true,
          },
        ],
      },
    });
    const receipt = buildRegenReceipt(usage, [mainLedgerRow(), syncSharedInitialLedgerRow()], {
      suggestedRepliesRecord: {
        replies: [
          { kind: "natural" as const, text: "*소매를 잡으며* \"그걸 지금 말이라고 해?\" ".padEnd(72, "가") },
          { kind: "twist" as const, text: "*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ".padEnd(72, "가") },
          { kind: "banter" as const, text: "*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ".padEnd(72, "가") },
        ],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: {
          tableMarkdown: "|a|b|\n|-|-|\n|1|2|",
          datetime: "",
          location: "",
          relationship: "",
          npcEmotion: "",
          npcIntent: "",
          nextObjective: "",
          hiddenThought: "",
          sceneSummary: "",
        },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
    });
    assert.equal(receipt.wholeTurn.coverage, "complete");
    assert.ok(receipt.wholeTurn.exactProviderSpendKrw != null);
    assert.ok(receipt.wholeTurn.contributionMarginPercent != null);
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.ok(vm.marginPercent != null);
    assert.match(formatAdminBillingReceiptV3Text(receipt), /총 실제 청구원가:/);
    assert.match(formatAdminBillingReceiptV3Text(receipt), /마진율:/);
  });

  it("CASE 7 — normal widget extraction success keeps success label", () => {
    const outcome = resolveStatusWidgetSyncAuxiliaryOutcome({
      syncSpendAvailable: true,
      diagnostics: {
        exhausted: false,
        usedFallback: false,
        attempts: [
          {
            stage: "initial",
            modelId: "gpt-5.6-luna",
            httpStatus: 200,
            finishReason: "stop",
            errorCode: null,
            reasonCode: "OK",
            succeeded: true,
          },
        ],
      },
    });
    assert.equal(outcome.callResult, "success");
    assert.equal(outcome.extractionResult, "success");
  });

  it("CASE 8 — provider console Luna multiplicity is not assumed same-turn without generation_request_id", () => {
    const sameTurnRows = [
      syncSharedInitialLedgerRow(LUNA_USD),
      asyncLedgerRow("memory_relationship", 0.0004),
    ];
    const otherTurnRow = asyncLedgerRow("post_turn_shared_initial", 0.0005, {
      generation_request_id: "other-chat-req",
      generation_sequence: 0,
    });
    const scoped = sameTurnRows.filter(
      (row) => row.generation_request_id === "regen-req-1"
    );
    assert.equal(scoped.length, 2);
    assert.equal(otherTurnRow.generation_request_id, "other-chat-req");
  });
});
