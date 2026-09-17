import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { streamOpenRouterAdult } from "./openRouterAdult";
import { parseCompatibleUsage, tokenUsageFromOpenRouterBreakdown } from "./openRouterUsage";
import {
  ensureProviderCostLedgerSchema,
  listProviderCostEventsForAssistantMessage,
  recordMainGenerationProviderCost,
  resolveLedgerAttemptSettlement,
} from "./providerCostLedger";
import { buildAdminBillingReceiptV3 } from "./adminBillingReceiptV3";
import type { Usage } from "./chatUsage";

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

describe("CheaperInference streaming exact cost capture", () => {
  it("captures cheaper_inference.billing.billed_cost_usd from documented final event", async () => {
    const previousFetch = globalThis.fetch;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello." } }] })}\n\n`,
        `data: ${JSON.stringify({
          id: "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788",
          choices: [],
          usage: {
            prompt_tokens: 31087,
            completion_tokens: 3654,
            total_tokens: 34741,
            cost: 0.0194,
            cost_details: { upstream_inference_cost: 0.0194 },
          },
          cheaper_inference: {
            request_id: "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788",
            billing: { status: "settled", billed_cost_usd: "0.019400", currency: "USD" },
          },
        })}\n\n`,
        "data: [DONE]\n\n",
      ])) as typeof fetch;

    try {
      const gen = streamOpenRouterAdult(
        "system",
        [{ role: "user", content: "hello" }],
        "deepseek-v4-pro-0813",
        800,
        { allowOpenRouterUnderLengthRecovery: false, skipAssistantPrefill: true }
      );
      let usage = { inputTokens: 0, outputTokens: 0, estimated: true };
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          usage = value;
          break;
        }
        void value;
      }
      assert.equal(usage.providerRequestId, "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788");
      assert.equal(usage.inputTokens, 31087);
      assert.equal(usage.outputTokens, 3654);
      assert.equal(usage.cheaperInferenceBilledCostUsd, 0.0194);
    } finally {
      globalThis.fetch = previousFetch;
      delete process.env.CHEAPER_INFERENCE_API_KEY;
    }
  });

  it("promotes usage.cost to cheaperInferenceBilledCostUsd when CI header present without envelope", async () => {
    const previousFetch = globalThis.fetch;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      sseResponse(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello." } }] })}\n\n`,
          `data: ${JSON.stringify({
            usage: { prompt_tokens: 31087, completion_tokens: 3654 },
          })}\n\n`,
          `data: ${JSON.stringify({
            id: "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788",
            choices: [],
            usage: {
              prompt_tokens: 31087,
              completion_tokens: 3654,
              cost: 0.0194,
              cost_details: { upstream_inference_cost: 0.0194 },
            },
          })}\n\n`,
          "data: [DONE]\n\n",
        ],
        { "x-cheaper-inference-request-id": "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788" }
      )) as typeof fetch;

    try {
      const gen = streamOpenRouterAdult(
        "system",
        [{ role: "user", content: "hello" }],
        "deepseek-v4-pro-0813",
        800,
        { allowOpenRouterUnderLengthRecovery: false, skipAssistantPrefill: true }
      );
      let usage = { inputTokens: 0, outputTokens: 0, estimated: true };
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          usage = value;
          break;
        }
        void value;
      }
      assert.equal(usage.cheaperInferenceBilledCostUsd, 0.0194);
      assert.equal(usage.upstreamCostUsd, 0.0194);
    } finally {
      globalThis.fetch = previousFetch;
      delete process.env.CHEAPER_INFERENCE_API_KEY;
    }
  });

  it("parseCompatibleUsage leaves non-CI usage.cost as upstream only", () => {
    const breakdown = parseCompatibleUsage({
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.01 },
    });
    assert.equal(breakdown.upstreamCostUsd, 0.01);
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, undefined);
  });

  it("main ledger settles with cheaper_inference_billed from stream usage", () => {
    const db = new Database(":memory:");
    ensureProviderCostLedgerSchema(db);
    const { eventKey, recorded } = recordMainGenerationProviderCost(
      {
        chatId: 1,
        assistantMessageId: 42,
        generationSequence: 0,
        provider: "cheaperinference",
        model: "deepseek-v4-pro-0813",
        requestKind: "main-rp",
        inputTokens: 31087,
        outputTokens: 3654,
        cheaperInferenceBilledCostUsd: 0.0194,
        upstreamCostUsd: 0.0194,
        usageEstimated: false,
        providerRequestId: "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788",
        outcome: "success",
        persistInTests: true,
      },
      db
    );
    assert.equal(recorded, true);
    const row = db
      .prepare(
        "SELECT event_status, actual_cost_source, actual_cost_usd, cheaper_inference_billed_cost_usd, provider_request_id FROM api_cost_ledger WHERE event_key = ?"
      )
      .get(eventKey) as {
      event_status: string;
      actual_cost_source: string;
      actual_cost_usd: number;
      cheaper_inference_billed_cost_usd: number;
      provider_request_id: string;
    };
    assert.equal(row.event_status, "settled");
    assert.equal(row.actual_cost_source, "cheaper_inference_billed");
    assert.equal(row.actual_cost_usd, 0.0194);
    assert.equal(row.cheaper_inference_billed_cost_usd, 0.0194);
    assert.equal(row.provider_request_id, "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788");
    db.close();
  });

  it("ledger settlement stays incomplete without exact CI cost", () => {
    const settlement = resolveLedgerAttemptSettlement({
      actualProvider: "cheaperinference",
      upstreamCostUsd: undefined,
      usageEstimated: false,
      outcome: "success",
    });
    assert.equal(settlement.settled, false);
    assert.equal(settlement.eventStatus, "completed_without_exact_cost");
  });

  it("Admin Receipt shows main RP exact provider USD from ledger row", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
    `);
    ensureProviderCostLedgerSchema(db);
    recordMainGenerationProviderCost(
      {
        chatId: 1,
        assistantMessageId: 99,
        generationSequence: 0,
        provider: "cheaperinference",
        model: "deepseek-v4-pro-0813",
        requestKind: "main-rp",
        inputTokens: 31087,
        outputTokens: 3654,
        cheaperInferenceBilledCostUsd: 0.0194,
        upstreamCostUsd: 0.0194,
        usageEstimated: false,
        providerRequestId: "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788",
        outcome: "success",
        persistInTests: true,
      },
      db
    );
    const ledgerRows = listProviderCostEventsForAssistantMessage(99, db);
    const usage: Usage = {
      input: 31087,
      output: 3654,
      model: "deepseek-v4-pro-0813",
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
        fxSnapshot: {
          dateKey: "2026-09-17",
          source: "api_daily",
          baseUsdKrw: 1369,
          overseasFeeRate: 0.02,
          effectiveKrwPerUsd: 1396,
        },
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualTurnCostCoverage: "partial",
        actualProviderCostKrw: null,
        actualCostUsd: null,
        actualCostSource: "unavailable",
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
        actualGrossProfitKrw: null,
        actualRealizedMargin: null,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: "deepseek-v4-pro-0813",
        provider: "cheaperinference",
      },
    };
    const receipt = buildAdminBillingReceiptV3({
      usage,
      assistantMessageId: 99,
      chatId: 1,
      ledgerRows,
      memoryRelationshipTask: null,
    });
    assert.equal(receipt.wholeTurn.mainExact, true);
    assert.ok(receipt.wholeTurn.mainActualCostUsd != null);
    assert.ok(Math.abs(receipt.wholeTurn.mainActualCostUsd! - 0.0194) < 0.0001);
    db.close();
  });

  it("tokenUsageFromOpenRouterBreakdown threads cheaperInferenceBilledCostUsd", () => {
    const breakdown = parseCompatibleUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.0194,
        cost_details: { upstream_inference_cost: 0.0194 },
      },
      headers: new Headers({ "x-cheaper-inference-request-id": "req-1" }),
    });
    const usage = tokenUsageFromOpenRouterBreakdown(breakdown);
    assert.equal(usage.cheaperInferenceBilledCostUsd, 0.0194);
  });
});
