import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOpusRollingGrossMargin,
  isOpusTierPricedModel,
  resolveOpusUserTurnCharge,
} from "./opusTierPricing";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CLAUDE_OPUS_MODEL,
  CLAUDE_OPUS_MODEL_LEGACY,
} from "@/lib/chatModels";
import {
  billableOutputChars,
  computeOpenRouterTurnBilling,
  computeTurnBilling,
  explainOpenRouterOpusTurnCost,
  resolveOpenRouterOpusTurnCharge,
  shouldWaiveTurnBilling,
} from "./points";
import { usageToOpusPaidTurn } from "./opusMarginTelemetry";
import type { Usage } from "./chatUsage";

const OPUS = "claude-opus-5";

describe("Opus tier-priced model allowlist", () => {
  it("accepts production Claude Opus 5", () => {
    assert.equal(isOpusTierPricedModel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
    assert.equal(isOpusTierPricedModel("Claude-Opus-5"), true);
  });

  it("accepts known legacy OpenRouter Opus slugs", () => {
    assert.equal(isOpusTierPricedModel(CLAUDE_OPUS_MODEL), true);
    assert.equal(isOpusTierPricedModel(CLAUDE_OPUS_MODEL_LEGACY), true);
    assert.equal(isOpusTierPricedModel("claude-opus"), true);
    assert.equal(isOpusTierPricedModel("anthropic/claude-opus-latest"), true);
  });

  it("rejects unknown or future ids that only contain opus", () => {
    assert.equal(isOpusTierPricedModel("my-opus-test"), false);
    assert.equal(isOpusTierPricedModel("future-opus-experimental"), false);
    assert.equal(isOpusTierPricedModel("not-opus"), false);
    assert.equal(isOpusTierPricedModel("anthropic/claude-opus-4.6"), false);
    assert.equal(isOpusTierPricedModel(""), false);
    assert.equal(isOpusTierPricedModel(null), false);
  });
});

describe("Opus output-length tier user pricing", () => {
  const cases = [
    { chars: 2300, input: 30_000, expect: 380 },
    { chars: 3000, input: 30_000, expect: 430 },
    { chars: 3000, input: 50_000, expect: 440 },
    { chars: 4000, input: 50_000, expect: 490 },
    { chars: 5000, input: 62_000, expect: 550 },
    { chars: 5000, input: 90_000, expect: 560 },
    { chars: 6000, input: 62_000, expect: 600 },
    { chars: 7000, input: 120_000, expect: 620 },
  ] as const;

  for (const row of cases) {
    it(`${row.chars} chars / ${row.input} input → ${row.expect}P`, () => {
      const charge = resolveOpusUserTurnCharge({
        outputChars: row.chars,
        apiInputTokens: row.input,
      });
      assert.equal(charge.finalChargePoints, row.expect);
      assert.equal(
        resolveOpenRouterOpusTurnCharge(999, row.chars, row.input).total,
        row.expect
      );
      assert.equal(
        computeOpenRouterTurnBilling({
          modelId: OPUS,
          inputTokens: row.input,
          outputTokens: 2000,
          outputChars: row.chars,
        }).total,
        row.expect
      );
    });
  }

  it("ignores actual API cost and cache when chars+input are identical", () => {
    const cold = computeOpenRouterTurnBilling({
      modelId: OPUS,
      inputTokens: 50_000,
      outputTokens: 2500,
      outputChars: 3000,
      cacheReadTokens: 0,
      cacheWriteTokens: 24_000,
      upstreamCostUsd: 0.16,
    });
    const warm = computeOpenRouterTurnBilling({
      modelId: OPUS,
      inputTokens: 50_000,
      outputTokens: 2500,
      outputChars: 3000,
      cacheReadTokens: 37_000,
      cacheWriteTokens: 0,
      upstreamCostUsd: 0.03,
    });
    assert.equal(cold.total, 440);
    assert.equal(warm.total, 440);
    assert.equal(cold.total, warm.total);
    const expensive = resolveOpenRouterOpusTurnCharge(800, 3000, 50_000);
    const cheap = resolveOpenRouterOpusTurnCharge(20, 3000, 50_000);
    assert.equal(expensive.total, cheap.total);
  });

  it("caps at 620P", () => {
    assert.equal(
      resolveOpusUserTurnCharge({ outputChars: 9000, apiInputTokens: 200_000 }).finalChargePoints,
      620
    );
  });

  it("explain keeps admin raw cost but user total is the tier", () => {
    const cold = explainOpenRouterOpusTurnCost(50_000, 2500, OPUS, 4000, {
      cacheWriteTokens: 20_000,
      cacheReadTokens: 0,
    });
    const warm = explainOpenRouterOpusTurnCost(50_000, 2500, OPUS, 4000, {
      cacheWriteTokens: 0,
      cacheReadTokens: 20_000,
    });
    assert.equal(cold.applied, "output_tier");
    assert.equal(cold.total, 490);
    assert.equal(warm.total, 490);
    assert.ok(cold.rawCostKrw !== warm.rawCostKrw);
  });

  it("does not apply Opus tiers to unknown opus-like ids", () => {
    const unknown = computeOpenRouterTurnBilling({
      modelId: "my-opus-test",
      inputTokens: 200_000,
      outputTokens: 4000,
      outputChars: 9000,
    });
    assert.notEqual(unknown.total, 620);
    const future = computeOpenRouterTurnBilling({
      modelId: "future-opus-experimental",
      inputTokens: 200_000,
      outputTokens: 4000,
      outputChars: 9000,
    });
    assert.notEqual(future.total, 620);
  });

  it("computeTurnBilling cheaperinference Opus matches openrouter Opus", () => {
    const a = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: OPUS,
      inputTokens: 50_000,
      outputTokens: 2000,
      savedTextChars: 4000,
    });
    const b = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: "anthropic/claude-opus-4.5",
      inputTokens: 50_000,
      outputTokens: 2000,
      savedTextChars: 4000,
    });
    assert.equal(a.total, 490);
    assert.equal(b.total, 490);
  });
});

describe("Opus billing waivers stay 0P", () => {
  function userChargeAfterWaiver(
    text: string,
    opts: Parameters<typeof shouldWaiveTurnBilling>[1],
    chars = 2300
  ): number {
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: OPUS,
      inputTokens: 30_000,
      outputTokens: 800,
      savedTextChars: chars,
    });
    const reason = shouldWaiveTurnBilling(text, opts);
    return reason ? 0 : billing.total;
  }

  it("does not charge the 380P floor for waived degeneration", () => {
    assert.equal(shouldWaiveTurnBilling("ok", { degenerationAborted: true }), "degeneration");
    assert.equal(userChargeAfterWaiver("ok", { degenerationAborted: true }), 0);
  });

  it("does not charge the 380P floor for generation_failure / forced_abort", () => {
    assert.equal(
      shouldWaiveTurnBilling("", { generationFailure: "under_length" }),
      "generation_failure"
    );
    assert.equal(userChargeAfterWaiver("", { generationFailure: "under_length" }), 0);
    assert.equal(userChargeAfterWaiver("", { forcedAbort: true, adultMode: true }), 0);
    assert.equal(userChargeAfterWaiver("ok", { generationFailure: "safety" }), 0);
  });

  it("healthy short-but-valid output still uses the 380P tier", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(80);
    assert.equal(shouldWaiveTurnBilling(prose, { adultMode: true, targetResponseChars: 3200 }), null);
    assert.equal(userChargeAfterWaiver(prose, { adultMode: true, targetResponseChars: 3200 }, 2300), 380);
  });
});

describe("Opus visible RP chars exclude HTML markup", () => {
  it("prices from billable visible chars, not raw HTML length", () => {
    const body = "그는 창가에 서서 빗소리를 들었다. ".repeat(155);
    const html = `\`\`\`html\n<div class="status-widget">${"<span class='cell'></span>".repeat(200)}</div>\n\`\`\``;
    const raw = `${body}\n${html}`;
    const visible = billableOutputChars(raw);
    assert.ok(visible < raw.length, `visible ${visible} raw ${raw.length}`);
    assert.ok(visible >= 2500 && visible < 3500, `visible ${visible}`);
    assert.ok(raw.length >= 4500, `raw ${raw.length}`);
    assert.equal(
      resolveOpusUserTurnCharge({ outputChars: visible, apiInputTokens: 30_000 }).finalChargePoints,
      430
    );
    assert.ok(
      resolveOpusUserTurnCharge({ outputChars: raw.length, apiInputTokens: 30_000 }).finalChargePoints >
        430
    );
  });
});

describe("Opus rolling margin telemetry does not change price", () => {
  it("computes last-N windows from paid turns only", () => {
    const turns = [
      {
        deductedPoints: 430,
        mainApiRawCostKrw: 200,
        widgetApiRawCostKrw: 10,
        cacheWriteTokens: 0,
        visibleOutputChars: 3100,
      },
      {
        deductedPoints: 430,
        mainApiRawCostKrw: 280,
        widgetApiRawCostKrw: 12,
        cacheWriteTokens: 20_000,
        visibleOutputChars: 3050,
      },
      {
        deductedPoints: 0,
        mainApiRawCostKrw: 100,
        widgetApiRawCostKrw: 0,
        billingWaived: true,
        visibleOutputChars: 40,
      },
    ];
    const stats = computeOpusRollingGrossMargin(turns, 20);
    assert.equal(stats.turns, 2);
    assert.equal(stats.totalRevenuePoints, 860);
    assert.equal(stats.totalApiCostKrw, 502);
    assert.equal(stats.coldCacheWriteTurnCount, 1);
    assert.ok(stats.realizedGrossMarginPct != null);
    assert.equal(stats.targetGrossMargin, 0.45);
  });

  it("usageToOpusPaidTurn skips waived turns and does not double-count widget cost", () => {
    const waived = usageToOpusPaidTurn({
      model: OPUS,
      cost: 0,
      billingWaived: true,
      input: 1,
      output: 1,
      route: "nsfw",
      breakdown: [],
    } as Usage);
    assert.equal(waived, null);

    const paid = usageToOpusPaidTurn({
      model: OPUS,
      cost: 430,
      input: 1,
      output: 1,
      route: "nsfw",
      breakdown: [],
      apiRawCostKrw: 220,
      statusWidgetExtract: {
        model: "flash",
        modelLabel: "flash",
        input: 10,
        output: 10,
        apiRawCostKrw: 12,
        callCount: 1,
      },
      savedOutputChars: 3000,
    } as Usage);
    assert.equal(paid?.deductedPoints, 430);
    assert.equal(paid?.mainApiRawCostKrw, 208);
    assert.equal(paid?.widgetApiRawCostKrw, 12);
  });
});
