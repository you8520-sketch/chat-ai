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

/** Canonical CheaperInference final accounting SSE per provider docs. */
function buildCiCanonicalAccountingSse(opts?: {
  providerRequestId?: string;
  billedCostUsd?: string;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  content?: string;
}): {
  contentEvent: string;
  finishEvent: string;
  accountingEvent: string;
  doneEvent: string;
  billedCost: number;
  providerRequestId: string;
} {
  const providerRequestId = opts?.providerRequestId ?? "bfc3252f-1aca-4f4c-bd35-c8494f381e93";
  const billedCost = opts?.billedCostUsd ?? "0.019400";
  const promptTokens = opts?.promptTokens ?? 31692;
  const completionTokens = opts?.completionTokens ?? 3356;
  const cacheReadTokens = opts?.cacheReadTokens ?? 10240;
  const content = opts?.content ?? "Visible RP prose.";
  const contentEvent = `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}\n\n`;
  const finishEvent = `data: ${JSON.stringify({
    choices: [{ finish_reason: "stop", delta: {} }],
  })}\n\n`;
  const accountingEvent = `data: ${JSON.stringify({
    id: providerRequestId,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cost: Number(billedCost),
      cost_details: { upstream_inference_cost: Number(billedCost) },
      prompt_tokens_details: { cached_tokens: cacheReadTokens },
    },
    cheaper_inference: {
      request_id: providerRequestId,
      billing: { status: "settled", billed_cost_usd: billedCost, currency: "USD" },
    },
  })}\n\n`;
  const doneEvent = "data: [DONE]\n\n";
  return {
    contentEvent,
    finishEvent,
    accountingEvent,
    doneEvent,
    billedCost: Number(billedCost),
    providerRequestId,
  };
}

async function consumeStreamUsage(fetchImpl: typeof fetch) {
  const previousFetch = globalThis.fetch;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  globalThis.fetch = fetchImpl;
  try {
    const gen = streamOpenRouterAdult(
      "system",
      [{ role: "user", content: "hello" }],
      "deepseek-v4-pro-0813",
      800,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: "cheaperinference",
      }
    );
    while (true) {
      const { value, done } = await gen.next();
      if (done) return value;
      void value;
    }
    throw new Error("stream ended without usage return");
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
  }
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
        {
          allowOpenRouterUnderLengthRecovery: false,
          skipAssistantPrefill: true,
          transportProvider: "cheaperinference",
        }
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
        {
          allowOpenRouterUnderLengthRecovery: false,
          skipAssistantPrefill: true,
          transportProvider: "cheaperinference",
        }
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

  it("CASE 1: non-CI transport + usage.cost + cost_details stays upstream only", () => {
    const breakdown = parseCompatibleUsage({
      transportProvider: "openrouter",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    });
    assert.equal(breakdown.upstreamCostUsd, 0.01);
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, undefined);
  });

  it("CASE 2: CI transport + usage.cost + cost_details promotes exact billed cost", () => {
    const breakdown = parseCompatibleUsage({
      transportProvider: "cheaperinference",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.0194,
        cost_details: { upstream_inference_cost: 0.0194 },
      },
    });
    assert.equal(breakdown.upstreamCostUsd, 0.0194);
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.0194);
  });

  it("CASE 3: explicit cheaper_inference.billing.billed_cost_usd keeps envelope precedence", () => {
    const breakdown = parseCompatibleUsage({
      transportProvider: "cheaperinference",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.0194,
        cost_details: { upstream_inference_cost: 0.0194 },
      },
      cheaperInference: {
        billing: { billed_cost_usd: "0.008000", status: "settled" },
      },
    });
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(breakdown.upstreamCostUsd, 0.0194);
  });

  it("CASE 4: CI header only + usage.cost promotes exact billed cost", () => {
    const breakdown = parseCompatibleUsage({
      usage: {
        prompt_tokens: 31087,
        completion_tokens: 3654,
        cost: 0.0194,
        cost_details: { upstream_inference_cost: 0.0194 },
      },
      headers: new Headers({ "x-cheaper-inference-request-id": "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788" }),
    });
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.0194);
    assert.equal(breakdown.upstreamCostUsd, 0.0194);
  });

  it("parseCompatibleUsage leaves non-CI usage.cost as upstream only", () => {
    const breakdown = parseCompatibleUsage({
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.01 },
      transportProvider: "openrouter",
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

  it("C1: canonical CI accounting final event captures exact billed cost", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const usage = await consumeStreamUsage(async () =>
      sseResponse([
        fixture.contentEvent,
        fixture.finishEvent,
        fixture.accountingEvent,
        fixture.doneEvent,
      ])
    );
    assert.equal(usage.providerRequestId, fixture.providerRequestId);
    assert.equal(usage.cheaperInferenceBilledCostUsd, fixture.billedCost);
    assert.equal(usage.inputTokens, 31692);
    assert.equal(usage.outputTokens, 3356);
  });

  it("C2: final accounting JSON split across byte chunks is captured", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const accountingPayload = fixture.accountingEvent.replace(/^data: /, "").trim();
    const splitAt = Math.floor(accountingPayload.length / 2);
    const part1 = `data: ${accountingPayload.slice(0, splitAt)}`;
    const part2 = `${accountingPayload.slice(splitAt)}\n\n`;
    const usage = await consumeStreamUsage(async () =>
      sseResponse([fixture.contentEvent, part1, part2, fixture.doneEvent])
    );
    assert.equal(usage.cheaperInferenceBilledCostUsd, fixture.billedCost);
  });

  it("C3: final accounting event in trailing EOF buffer is captured exactly once", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const trailingWithoutNewline = `${fixture.contentEvent}${fixture.accountingEvent.replace(/\n\n$/, "")}`;
    const usage = await consumeStreamUsage(async () => sseResponse([trailingWithoutNewline]));
    assert.equal(usage.cheaperInferenceBilledCostUsd, fixture.billedCost);
  });

  it("C4: cost-less usage then cost-bearing usage preserves cost", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const usage = await consumeStreamUsage(async () =>
      sseResponse([
        fixture.contentEvent,
        `data: ${JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        })}\n\n`,
        fixture.accountingEvent,
        fixture.doneEvent,
      ])
    );
    assert.equal(usage.cheaperInferenceBilledCostUsd, fixture.billedCost);
  });

  it("C5: cost-bearing usage then later cost-less usage does not lose cost", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const usage = await consumeStreamUsage(async () =>
      sseResponse([
        fixture.contentEvent,
        fixture.accountingEvent,
        `data: ${JSON.stringify({
          usage: { prompt_tokens: 31692, completion_tokens: 3356 },
        })}\n\n`,
        fixture.doneEvent,
      ])
    );
    assert.equal(usage.cheaperInferenceBilledCostUsd, fixture.billedCost);
  });

  it("C6: OpenRouter transport + usage.cost + cost_details is not CI billed cost", () => {
    const breakdown = parseCompatibleUsage({
      transportProvider: "openrouter",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cost: 0.01,
        cost_details: { upstream_inference_cost: 0.01 },
      },
    });
    assert.equal(breakdown.upstreamCostUsd, 0.01);
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, undefined);
  });

  it("C7: CI response through gateStreamFirstVisible preserves terminal accounting", async () => {
    const fixture = buildCiCanonicalAccountingSse({ content: "Gate path prose here." });
    const trailingWithoutNewline = `${fixture.contentEvent}${fixture.accountingEvent.replace(/\n\n$/, "")}`;
    const previousFetch = globalThis.fetch;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    globalThis.fetch = (async () => sseResponse([trailingWithoutNewline])) as typeof fetch;
    try {
      const gen = streamOpenRouterAdult(
        "system",
        [{ role: "user", content: "hello" }],
        "deepseek-v4-pro-0813",
        800,
        {
          allowOpenRouterUnderLengthRecovery: false,
          skipAssistantPrefill: true,
        }
      );
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          assert.equal(value.cheaperInferenceBilledCostUsd, fixture.billedCost);
          assert.equal(value.providerRequestId, fixture.providerRequestId);
          return;
        }
        void value;
      }
      throw new Error("stream ended without usage return");
    } finally {
      globalThis.fetch = previousFetch;
      delete process.env.CHEAPER_INFERENCE_API_KEY;
    }
  });

  it("C8: provider cost ledger records exactly one main-rp row", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    const usage = await consumeStreamUsage(async () =>
      sseResponse([
        fixture.contentEvent,
        fixture.accountingEvent,
        fixture.doneEvent,
      ])
    );
    const db = new Database(":memory:");
    ensureProviderCostLedgerSchema(db);
    const first = recordMainGenerationProviderCost(
      {
        chatId: 707,
        assistantMessageId: 1001,
        generationSequence: 0,
        provider: "cheaperinference",
        model: "deepseek-v4-pro-0813",
        requestKind: "main-rp",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cheaperInferenceBilledCostUsd: usage.cheaperInferenceBilledCostUsd,
        upstreamCostUsd: usage.upstreamCostUsd,
        usageEstimated: usage.estimated,
        providerRequestId: usage.providerRequestId,
        outcome: "success",
        persistInTests: true,
      },
      db
    );
    const second = recordMainGenerationProviderCost(
      {
        chatId: 707,
        assistantMessageId: 1001,
        generationSequence: 0,
        provider: "cheaperinference",
        model: "deepseek-v4-pro-0813",
        requestKind: "main-rp",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cheaperInferenceBilledCostUsd: usage.cheaperInferenceBilledCostUsd,
        upstreamCostUsd: usage.upstreamCostUsd,
        usageEstimated: usage.estimated,
        providerRequestId: usage.providerRequestId,
        outcome: "success",
        persistInTests: true,
      },
      db
    );
    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    const rows = listProviderCostEventsForAssistantMessage(1001, db);
    assert.equal(rows.length, 1);
    db.close();
  });

  it("C9: Main provider attempts remain exactly one through stream path", async () => {
    const fixture = buildCiCanonicalAccountingSse();
    let fetchCount = 0;
    await consumeStreamUsage(async () => {
      fetchCount += 1;
      return sseResponse([fixture.contentEvent, fixture.accountingEvent, fixture.doneEvent]);
    });
    assert.equal(fetchCount, 1);
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
