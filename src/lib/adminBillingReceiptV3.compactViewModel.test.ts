import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminBillingReceiptV3,
  buildAdminBillingReceiptV3ForMissingUsage,
} from "@/lib/adminBillingReceiptV3";
import {
  buildAdminReceiptCompactViewModel,
  resolveMainRpCostProvenanceLabel,
  formatAdminBillingReceiptV3Text,
} from "@/lib/adminBillingReceiptV3Shared";
import type { Usage } from "@/lib/chatUsage";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 80,
    baseCost: 80,
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
      actualProviderCostKrw: 31.2,
      actualCostUsd: 0.100618,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 80,
      promoPercent: 0,
      finalShadowChargeKrw: 80,
      finalShadowPoints: 80,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 50,
      actualRealizedMargin: 0.625,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "deepseek/deepseek-v4-pro",
      provider: "cheaperinference",
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

function buildV3(
  usage: Usage,
  opts: Partial<Parameters<typeof buildAdminBillingReceiptV3>[0]> = {}
) {
  return buildAdminBillingReceiptV3({
    usage,
    assistantMessageId: 1,
    chatId: 1,
    suggestedRepliesRecord: null,
    statusMetaRecord: null,
    ledgerRows: [],
    ...opts,
  });
}

function asyncLedgerRow(family: string, usd: number): ProviderCostLedgerRow {
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
    generation_sequence: 0,
  } as unknown as ProviderCostLedgerRow;
}

describe("Admin Receipt compact view model — provenance & auxiliary summary", () => {
  it("A — Main RP only: shows CI billed provenance, no auxiliary calls", () => {
    const receipt = buildV3(baseUsage());
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(vm.mainRp.costUsd, 0.100618);
    assert.equal(vm.mainRp.provenanceLabel, "CI 실제 청구 원가");
    assert.equal(vm.mainRp.model, "DeepSeek V4 Pro");
    assert.deepEqual(vm.auxiliaryCalls, []);
  });

  it("H — provider actual cost known: provider_reported label", () => {
    const receipt = buildV3(
      baseUsage({
        shadowPricing: {
          ...baseUsage().shadowPricing!,
          actualCostSource: "provider_reported",
          actualCostUsd: 0.02,
        },
      })
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(vm.mainRp.provenanceLabel, "Provider 실제 청구 원가");
  });

  it("I — provider cost genuinely unavailable: no provenance label / cost hidden", () => {
    const receipt = buildV3(
      baseUsage({
        shadowPricing: {
          ...baseUsage().shadowPricing!,
          actualCostSource: "unavailable",
          actualCostUsd: undefined,
          actualProviderCostKrw: 0,
        },
      })
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(vm.mainRp.costUsd, null);
    assert.equal(vm.mainRp.provenanceLabel, null);
  });

  it("estimated catalog source gets Published 기준 추정 원가 label", () => {
    assert.equal(
      resolveMainRpCostProvenanceLabel("live_catalog_estimated"),
      "Published 기준 추정 원가"
    );
    assert.equal(
      resolveMainRpCostProvenanceLabel("published_fallback_estimated"),
      "Published 기준 추정 원가"
    );
    assert.equal(resolveMainRpCostProvenanceLabel("unavailable"), null);
  });

  it("B — Main RP + status widget sync call: auxiliary shows the sync widget call once", () => {
    const receipt = buildV3(
      baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "gpt-5.6-luna",
          modelLabel: "Luna",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.000928,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 1.5,
        },
      })
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    const widget = vm.auxiliaryCalls.find((c) => c.label === "상태창 위젯");
    assert.ok(widget, "status widget call must be listed");
    assert.equal(widget?.calls, 1);
    assert.equal(widget?.model, "Luna");
    assert.equal(widget?.costUsd, 0.000928);
  });

  it("C — Main RP + relationship memory: relationship memory auxiliary row present", () => {
    const receipt = buildV3(baseUsage(), {
      memoryRelationshipTask: memoryTask("succeeded"),
      ledgerRows: [asyncLedgerRow("memory_relationship", 0.000404)],
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    const rel = vm.auxiliaryCalls.find((c) => c.label === "Relationship Memory");
    assert.ok(rel, "relationship memory call must be listed");
    assert.equal(rel?.costUsd, 0.000404);
  });

  it("D — Main RP + both auxiliary calls: both rows present exactly once", () => {
    const receipt = buildV3(
      baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "gpt-5.6-luna",
          modelLabel: "Luna",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.000928,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 1.5,
        },
      }),
      {
        memoryRelationshipTask: memoryTask("succeeded"),
        ledgerRows: [asyncLedgerRow("memory_relationship", 0.000404)],
      }
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    const relRows = vm.auxiliaryCalls.filter((c) => c.label === "Relationship Memory");
    const widgetRows = vm.auxiliaryCalls.filter((c) => c.label === "상태창 위젯");
    assert.equal(relRows.length, 1);
    assert.equal(widgetRows.length, 1);
    assert.equal(vm.auxiliaryCalls.length, 2);
  });

  it("E — optional Suggested Replies calls=0: row hidden (NOT_CALLED not shown)", () => {
    const receipt = buildV3(baseUsage(), {
      suggestedRepliesRecord: null,
      ledgerRows: [],
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(
      vm.auxiliaryCalls.some((c) => c.label === "Suggested Replies"),
      false,
      "zero-call Suggested Replies must not render"
    );
  });

  it("F — optional Status Meta calls=0: row hidden", () => {
    const receipt = buildV3(baseUsage(), { statusMetaRecord: null, ledgerRows: [] });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(
      vm.auxiliaryCalls.some((c) => c.label === "Status Meta"),
      false,
      "zero-call Status Meta must not render"
    );
  });

  it("G — expected async call but missing record: no auxiliary row, not treated as a call", () => {
    const receipt = buildV3(baseUsage(), {
      memoryRelationshipTask: null,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.deepEqual(vm.auxiliaryCalls, []);
  });

  it("cost consistency — auxiliary rows sum equals actual auxiliary spend; no fabricated total when coverage incomplete", () => {
    const mainUsd = 0.100618;
    const relUsd = 0.000404;
    const widgetUsd = 0.000928;
    const receipt = buildV3(
      baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "gpt-5.6-luna",
          modelLabel: "Luna",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: widgetUsd,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 1.5,
        },
      }),
      {
        memoryRelationshipTask: memoryTask("succeeded"),
        suggestedRepliesRecord: {
          replies: [],
          extractedAt: new Date().toISOString(),
          source: "background-deepseek",
          pending: false,
          failed: false,
        },
        statusMetaRecord: {
          meta: { tableMarkdown: "", datetime: "", location: "", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
          extractedAt: new Date().toISOString(),
          source: "background-deepseek",
          pending: false,
          failed: false,
          formatSpec: null,
        },
        ledgerRows: [asyncLedgerRow("memory_relationship", relUsd)],
      }
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    // Auxiliary rows must sum to the actual auxiliary spend (widget + relationship).
    const auxSum = vm.auxiliaryCalls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
    assert.ok(
      Math.abs(auxSum - (widgetUsd + relUsd)) < 1e-9,
      `aux sum ${auxSum} must equal ${widgetUsd + relUsd}`
    );
    // When whole-turn coverage is not complete, a fabricated "total" must not appear.
    if (!vm.hasCompleteTotal) {
      assert.equal(vm.completeTotalUsd, null);
    }
    // Main RP provenance is always shown separately.
    assert.equal(vm.mainRp.costUsd, mainUsd);
  });

  it("partial/unsettled Main RP: complete total not shown (no fabricated total)", () => {
    const receipt = buildV3(
      baseUsage({
        shadowPricing: {
          ...baseUsage().shadowPricing!,
          actualCostSource: "live_catalog_estimated",
          actualCostUsd: 0.1,
          actualTurnCostCoverage: "complete",
        },
      })
    );
    const vm = buildAdminReceiptCompactViewModel(receipt);
    // Estimated Main RP => whole-turn coverage is not complete => no total section.
    assert.equal(vm.hasCompleteTotal, false);
  });

  it("J — historical receipt (missing usage): no fabricated main cost, no total", () => {
    const receipt = buildAdminBillingReceiptV3ForMissingUsage({
      assistantMessageId: 1,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    assert.equal(vm.mainRp.costUsd, null);
    assert.equal(vm.mainRp.provenanceLabel, null);
    assert.equal(vm.hasCompleteTotal, false);
  });

  it("clipboard compact text omits verbose turn-summary and shows provenance", () => {
    const receipt = buildV3(baseUsage(), {
      memoryRelationshipTask: memoryTask("succeeded"),
      ledgerRows: [asyncLedgerRow("memory_relationship", 0.000404)],
    });
    const text = formatAdminBillingReceiptV3Text(receipt);
    assert.match(text, /CI 실제 청구 원가/);
    assert.match(text, /이번 턴 보조 호출/);
    assert.match(text, /Relationship Memory/);
    assert.doesNotMatch(text, /\[Turn Summary\]/);
    assert.doesNotMatch(text, /coverage:/);
  });
});