/**
 * Admin Finance vs Admin Receipt V3 cost-scope audit — computed from fixtures.
 * Finance revenue owner remains persisted deduction_slices (no price recompute).
 */

import {
  resolveMessageTurnProviderCostKrw,
  resolveReceiptV3ExactProviderSpendKrw,
  type StatusWidgetExtractFinanceSource,
} from "@/lib/adminFinanceTurnCost";
import type { Usage } from "@/lib/chatUsage";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";

export type AdminFinanceCostScopeAudit = {
  ADMIN_RECEIPT_V3_ACTUAL_COST_SCOPE: string;
  ADMIN_FINANCE_CHAT_API_COST_SCOPE: string;
  MAIN_GENERATION_INCLUDED: boolean;
  SYNC_POST_TURN_INCLUDED: boolean;
  ASYNC_POST_TURN_INCLUDED: boolean;
  ADMIN_FINANCE_MISSING_COST_FAMILIES: readonly string[];
  ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES: readonly string[];
  ADMIN_FINANCE_REVENUE_OWNER: string;
  ADMIN_FINANCE_COST_OWNER: string;
  ADMIN_FINANCE_MARGIN_COVERAGE_OWNER: string;
  ADMIN_FINANCE_RECOMPUTES_USER_PRICE: false;
  TARGET_MARGIN_USED_AS_REALIZED_MARGIN: false;
  ADMIN_FINANCE_EXACT_COST_ALIGNMENT_REQUIRED: boolean;
  STATUS_WIDGET_EXTRACT_FINANCE_SOURCE: StatusWidgetExtractFinanceSource;
  STATUS_WIDGET_EXTRACT_DOUBLE_COUNT: boolean;
  INCOMPLETE_PROVIDER_COST_CAN_BE_EXACT: boolean;
  ESTIMATED_MAIN_COST_CAN_BE_EXACT: boolean;
  MIXED_EXACT_INCOMPLETE_ASYNC_EXACT_TOTAL: boolean;
  ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED: boolean;
  F8: "PASS" | "FAIL";
  F9: "PASS" | "FAIL";
  F10: "PASS" | "FAIL";
  F11: "PASS" | "FAIL";
  ADMIN_FINANCE_REALIZED_MARGIN_READY: "YES" | "NO";
};

const RECEIPT_V3_SCOPE =
  "turn_attributable whole-turn: main RP actual + sync platform spend + async post-turn api_cost_ledger (suggested_replies_repair, status_meta, memory_relationship, post_turn_shared_initial, status_widget_extract)";

const FINANCE_CHAT_API_COST_SCOPE =
  "resolveMessageTurnProviderCostKrw() per assistant row: knownApiCostKrw + coverage/exactness (fail-closed realized margin)";

const ALL_FAMILIES = [
  "main_generation",
  "post_turn_shared_initial",
  "status_widget_extract",
  "suggested_replies_repair",
  "status_meta",
  "memory_relationship",
] as const;

type FixtureScenario = {
  id: string;
  usage: Usage;
  ledgerRows: ProviderCostLedgerRow[];
  expectKnownKrw: number;
  expectReceiptKrw: number | null;
  expectCoverageComplete?: boolean;
  expectWidgetSource?: StatusWidgetExtractFinanceSource;
  expectNoDoubleCount?: boolean;
};

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function usdForKrw(krw: number): number {
  return krw / FX.effectiveKrwPerUsd;
}

function ledgerStub(
  family: string,
  phase: "async_post_turn" | "sync_post_turn",
  krw: number,
  assistantMessageId = 1,
  eventStatus: ProviderCostLedgerRow["event_status"] = "settled"
): ProviderCostLedgerRow {
  const usd = usdForKrw(krw);
  const exact = eventStatus === "settled" && krw > 0;
  return {
    id: 1,
    event_key: `${family}-${phase}-${assistantMessageId}`,
    chat_id: 1,
    assistant_message_id: assistantMessageId,
    family,
    funding_class: "platform_funded",
    execution_phase: phase,
    attempt_ordinal: 1,
    requested_provider: "cheaperinference",
    requested_model: "deepseek-v4-flash",
    provider: "cheaperinference",
    model: "deepseek-v4-flash",
    actual_provider: "cheaperinference",
    actual_model: "deepseek-v4-flash",
    request_kind: "",
    provider_request_id: null,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: null,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cheaper_inference_billed_cost_usd: exact ? usd : null,
    upstream_cost_usd: exact ? null : 0.002,
    actual_cost_usd: exact ? usd : null,
    actual_cost_source: exact ? "cheaper_inference_billed" : "unavailable",
    event_status: eventStatus,
    exchange_rate_krw_per_usd: FX.effectiveKrwPerUsd,
    cost_krw: krw,
    estimated: exact ? 0 : 1,
    generation_sequence: 0,
    generation_request_id: null,
    created_at: "2026-08-30",
    completed_at: "2026-08-30",
  };
}

function mainUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 100,
    baseCost: 100,
    breakdown: [],
    mainApiRawCostKrw: 40,
    apiRawCostKrw: 40,
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
      actualProviderCostKrw: 40,
      actualCostUsd: usdForKrw(40),
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 100,
      promoPercent: 0,
      finalShadowChargeKrw: 100,
      finalShadowPoints: 100,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 60,
      actualRealizedMargin: 0.6,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "deepseek/deepseek-v4-pro",
      provider: "cheaperinference",
    },
    ...overrides,
  };
}

function syncExtract(krw: number, postTurnSharedInitial = false): Partial<Usage> {
  const usd = usdForKrw(krw);
  return {
    mainApiRawCostKrw: 40,
    apiRawCostKrw: 40 + krw,
    statusWidgetExtract: {
      model: "deepseek-v4-flash",
      modelLabel: "DeepSeek V4 Flash",
      input: 100,
      output: 50,
      apiRawCostKrw: krw,
      callCount: 1,
      actualProviderCostUsd: usd,
      actualProviderCostKrw: krw,
      actualCostSource: "cheaper_inference_billed",
      actualCostCoverage: "complete",
      ...(postTurnSharedInitial ? { postTurnSharedInitial: true } : {}),
    },
  };
}

function buildFixtureScenarios(): FixtureScenario[] {
  return [
    {
      id: "main-only",
      usage: mainUsage(),
      ledgerRows: [],
      expectKnownKrw: 40,
      expectReceiptKrw: 40,
      expectCoverageComplete: true,
    },
    {
      id: "main-sync",
      usage: mainUsage(syncExtract(5)),
      ledgerRows: [],
      expectKnownKrw: 45,
      expectReceiptKrw: 45,
      expectCoverageComplete: true,
      expectWidgetSource: "usage",
    },
    {
      id: "main-async",
      usage: mainUsage(),
      ledgerRows: [
        ledgerStub("suggested_replies_repair", "async_post_turn", 3),
        ledgerStub("status_meta", "async_post_turn", 2),
        ledgerStub("memory_relationship", "async_post_turn", 4),
      ],
      expectKnownKrw: 49,
      expectReceiptKrw: 49,
      expectCoverageComplete: true,
    },
    {
      id: "main-sync-async",
      usage: mainUsage(syncExtract(5, true)),
      ledgerRows: [
        ledgerStub("suggested_replies_repair", "async_post_turn", 3),
        ledgerStub("status_meta", "async_post_turn", 2),
        ledgerStub("memory_relationship", "async_post_turn", 4),
      ],
      expectKnownKrw: 54,
      expectReceiptKrw: 54,
      expectCoverageComplete: true,
      expectWidgetSource: "usage",
    },
    {
      id: "widget-no-double-count",
      usage: mainUsage(syncExtract(5)),
      ledgerRows: [ledgerStub("status_widget_extract", "sync_post_turn", 5)],
      expectKnownKrw: 45,
      expectReceiptKrw: 45,
      expectCoverageComplete: true,
      expectWidgetSource: "usage",
      expectNoDoubleCount: true,
    },
  ];
}

function evaluateExactnessFixtures(): {
  F8: "PASS" | "FAIL";
  F9: "PASS" | "FAIL";
  F10: "PASS" | "FAIL";
  F11: "PASS" | "FAIL";
  INCOMPLETE_PROVIDER_COST_CAN_BE_EXACT: boolean;
  ESTIMATED_MAIN_COST_CAN_BE_EXACT: boolean;
  MIXED_EXACT_INCOMPLETE_ASYNC_EXACT_TOTAL: boolean;
  ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED: boolean;
} {
  const f8Rows = [ledgerStub("status_meta", "async_post_turn", 0, 8, "completed_without_exact_cost")];
  const f8 = resolveMessageTurnProviderCostKrw(mainUsage(), f8Rows);
  const f8Pass =
    f8.knownApiCostKrw === 40 &&
    f8.coverage !== "complete" &&
    f8.realizedMarginExact === false &&
    f8.exactApiCostKrw == null;

  const f9Rows = [
    ledgerStub("suggested_replies_repair", "async_post_turn", 3, 9),
    ledgerStub("status_meta", "async_post_turn", 0, 9, "completed_without_exact_cost"),
  ];
  const f9 = resolveMessageTurnProviderCostKrw(mainUsage(), f9Rows);
  const f9Pass =
    f9.knownApiCostKrw === 43 &&
    f9.exactApiCostKrw == null &&
    f9.realizedMarginExact === false &&
    resolveReceiptV3ExactProviderSpendKrw(mainUsage(), f9Rows) == null;

  const estimatedUsage = mainUsage({
    shadowPricing: {
      ...mainUsage().shadowPricing!,
      actualCostSource: "live_catalog_estimated",
      actualTurnCostCoverage: "partial",
    },
    mainApiRawCostKrw: 55,
    apiRawCostKrw: 55,
  });
  const f10 = resolveMessageTurnProviderCostKrw(estimatedUsage, []);
  const f10Pass =
    f10.knownApiCostKrw === 55 &&
    f10.coverage !== "complete" &&
    f10.realizedMarginExact === false &&
    f10.hasEstimatedProviderCost === true;

  const f11Rows = [
    ledgerStub("suggested_replies_repair", "async_post_turn", 3, 11),
    ledgerStub("status_meta", "async_post_turn", 2, 11),
    ledgerStub("memory_relationship", "async_post_turn", 4, 11),
  ];
  const f11 = resolveMessageTurnProviderCostKrw(mainUsage(syncExtract(5, true)), f11Rows);
  const f11Pass =
    f11.coverage === "complete" &&
    f11.realizedMarginExact === true &&
    f11.exactApiCostKrw === 54;

  const incompleteCanBeExact = f8.realizedMarginExact || f9.realizedMarginExact;
  const estimatedCanBeExact = f10.realizedMarginExact;
  const mixedAsyncBug =
    resolveReceiptV3ExactProviderSpendKrw(mainUsage(), f9Rows) != null;

  return {
    F8: f8Pass ? "PASS" : "FAIL",
    F9: f9Pass ? "PASS" : "FAIL",
    F10: f10Pass ? "PASS" : "FAIL",
    F11: f11Pass ? "PASS" : "FAIL",
    INCOMPLETE_PROVIDER_COST_CAN_BE_EXACT: incompleteCanBeExact,
    ESTIMATED_MAIN_COST_CAN_BE_EXACT: estimatedCanBeExact,
    MIXED_EXACT_INCOMPLETE_ASYNC_EXACT_TOTAL: mixedAsyncBug,
    ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED:
      !incompleteCanBeExact && !estimatedCanBeExact && !mixedAsyncBug,
  };
}

export function evaluateAdminFinanceCostScopeFromFixtures(): AdminFinanceCostScopeAudit {
  const scenarios = buildFixtureScenarios();
  const exactness = evaluateExactnessFixtures();
  const missingFamilies = new Set<string>();
  const doubleCountedFamilies = new Set<string>();
  let mainIncluded = true;
  let syncIncluded = true;
  let asyncIncluded = true;
  let widgetSource: StatusWidgetExtractFinanceSource = "none";
  let widgetDoubleCount = false;

  for (const scenario of scenarios) {
    const cost = resolveMessageTurnProviderCostKrw(scenario.usage, scenario.ledgerRows);
    const receiptKrw = resolveReceiptV3ExactProviderSpendKrw(
      scenario.usage,
      scenario.ledgerRows
    );

    if (cost.knownApiCostKrw !== scenario.expectKnownKrw) {
      throw new Error(
        `${scenario.id}: finance ${cost.knownApiCostKrw} != expected ${scenario.expectKnownKrw}`
      );
    }
    if (receiptKrw !== scenario.expectReceiptKrw) {
      throw new Error(
        `${scenario.id}: receipt ${receiptKrw} != expected ${scenario.expectReceiptKrw}`
      );
    }
    if (scenario.expectCoverageComplete && cost.coverage !== "complete") {
      throw new Error(`${scenario.id}: expected complete coverage got ${cost.coverage}`);
    }
    if (receiptKrw != null && Math.abs(receiptKrw - cost.exactApiCostKrw!) > 0.05) {
      throw new Error(`${scenario.id}: finance/receipt exact provenance mismatch`);
    }

    if (scenario.id === "main-only" && cost.familyKrw.main_generation <= 0) {
      mainIncluded = false;
    }
    if (scenario.id === "main-sync" && cost.syncPostTurnKrw <= 0) {
      syncIncluded = false;
    }
    if (scenario.id === "main-async" && cost.asyncPostTurnKrw <= 0) {
      asyncIncluded = false;
    }

    if (scenario.expectWidgetSource) {
      widgetSource = cost.statusWidgetExtractFinanceSource;
      if (widgetSource !== scenario.expectWidgetSource) {
        throw new Error(
          `${scenario.id}: widget source ${widgetSource} != ${scenario.expectWidgetSource}`
        );
      }
    }

    if (scenario.expectNoDoubleCount) {
      const usageOnly = resolveMessageTurnProviderCostKrw(scenario.usage, []).knownApiCostKrw;
      const withLedger = cost.knownApiCostKrw;
      if (withLedger > usageOnly) {
        widgetDoubleCount = true;
        doubleCountedFamilies.add("status_widget_extract");
      }
    }
  }

  for (const family of ALL_FAMILIES) {
    const covered = scenarios.some((s) => {
      const c = resolveMessageTurnProviderCostKrw(s.usage, s.ledgerRows);
      if (family === "main_generation") return c.familyKrw.main_generation > 0;
      if (family === "post_turn_shared_initial") return c.familyKrw.post_turn_shared_initial > 0;
      if (family === "status_widget_extract") return c.familyKrw.status_widget_extract > 0;
      if (family === "suggested_replies_repair")
        return c.familyKrw.suggested_replies_repair > 0;
      if (family === "status_meta") return c.familyKrw.status_meta > 0;
      if (family === "memory_relationship") return c.familyKrw.memory_relationship > 0;
      return false;
    });
    if (!covered) {
      missingFamilies.add(family);
    }
  }

  const ready =
    missingFamilies.size === 0 &&
    doubleCountedFamilies.size === 0 &&
    mainIncluded &&
    syncIncluded &&
    asyncIncluded &&
    !widgetDoubleCount &&
    exactness.ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED &&
    exactness.F8 === "PASS" &&
    exactness.F9 === "PASS" &&
    exactness.F10 === "PASS" &&
    exactness.F11 === "PASS";

  return {
    ADMIN_RECEIPT_V3_ACTUAL_COST_SCOPE: RECEIPT_V3_SCOPE,
    ADMIN_FINANCE_CHAT_API_COST_SCOPE: FINANCE_CHAT_API_COST_SCOPE,
    MAIN_GENERATION_INCLUDED: mainIncluded,
    SYNC_POST_TURN_INCLUDED: syncIncluded,
    ASYNC_POST_TURN_INCLUDED: asyncIncluded,
    ADMIN_FINANCE_MISSING_COST_FAMILIES: [...missingFamilies],
    ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES: [...doubleCountedFamilies],
    ADMIN_FINANCE_REVENUE_OWNER:
      "messages.deduction_slices (paid+free slice totals) in buildAdminFinanceSummary()",
    ADMIN_FINANCE_COST_OWNER:
      "resolveMessageTurnProviderCostKrw() knownApiCostKrw + coverage per assistant message",
    ADMIN_FINANCE_MARGIN_COVERAGE_OWNER:
      "buildAdminFinanceSummary() aggregates turn coverage; marginRate/netProfit null unless realizedMarginExact",
    ADMIN_FINANCE_RECOMPUTES_USER_PRICE: false,
    TARGET_MARGIN_USED_AS_REALIZED_MARGIN: false,
    ADMIN_FINANCE_EXACT_COST_ALIGNMENT_REQUIRED: !ready,
    STATUS_WIDGET_EXTRACT_FINANCE_SOURCE: widgetSource,
    STATUS_WIDGET_EXTRACT_DOUBLE_COUNT: widgetDoubleCount,
    INCOMPLETE_PROVIDER_COST_CAN_BE_EXACT: exactness.INCOMPLETE_PROVIDER_COST_CAN_BE_EXACT,
    ESTIMATED_MAIN_COST_CAN_BE_EXACT: exactness.ESTIMATED_MAIN_COST_CAN_BE_EXACT,
    MIXED_EXACT_INCOMPLETE_ASYNC_EXACT_TOTAL: exactness.MIXED_EXACT_INCOMPLETE_ASYNC_EXACT_TOTAL,
    ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED: exactness.ADMIN_FINANCE_INCOMPLETE_COST_FAIL_CLOSED,
    F8: exactness.F8,
    F9: exactness.F9,
    F10: exactness.F10,
    F11: exactness.F11,
    ADMIN_FINANCE_REALIZED_MARGIN_READY: ready ? "YES" : "NO",
  };
}

export function auditAdminFinanceCostScope(): AdminFinanceCostScopeAudit {
  return evaluateAdminFinanceCostScopeFromFixtures();
}

export function adminFinanceRealizedMarginReady(
  audit: AdminFinanceCostScopeAudit = auditAdminFinanceCostScope()
): "YES" | "NO" {
  return audit.ADMIN_FINANCE_REALIZED_MARGIN_READY;
}
