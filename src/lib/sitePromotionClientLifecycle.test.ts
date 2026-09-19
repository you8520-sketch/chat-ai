import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "@/lib/chatModels";
import { createOfficialProviderPromotion } from "@/lib/officialProviderPromotion";
import { computeOpenRouterTurnBilling } from "@/lib/pointsReasoningMargins";
import { buildPublicBillingReceipt } from "@/lib/publicBillingReceipt";
import {
  formatSitePromotionUserLabel,
  resolveActiveSitePromotion,
  toSitePromotionClientView,
} from "@/lib/sitePromotion";
import {
  buildActiveSitePromotionClientViewMap,
  isSitePromotionClientViewActive,
  nearestActiveSitePromotionExpiryMs,
  type SitePromotionClientView,
} from "@/lib/sitePromotionClientView";
import type { Usage } from "@/lib/chatUsage";

const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;

function sampleView(endsAt: string): SitePromotionClientView {
  return {
    modelId: MODEL,
    siteDiscountPercent: 30,
    endsAt,
    title: "Gemini 기간 한정 모델 할인",
    subtitle: "기간 한정 모델 이용료 30% 할인",
    detailLine: "공식 프로모션 반영 · 자동 적용 · 2026.09.08까지",
    badge: "-30%",
  };
}

describe("site promotion client lifecycle helpers (pure)", () => {
  it("A: endsAt passed → client active check false and badge map empty (no reload)", () => {
    const endsAt = "2026-09-01T12:00:00.000Z";
    const afterExpiry = Date.parse("2026-09-01T12:00:01.000Z");
    const view = sampleView(endsAt);

    assert.equal(isSitePromotionClientViewActive(view, afterExpiry), false);
    assert.deepEqual(buildActiveSitePromotionClientViewMap([view], afterExpiry), {});
    assert.equal(nearestActiveSitePromotionExpiryMs([view], afterExpiry), null);
  });

  it("B: promotion becomes active after mount via refreshed client snapshot", () => {
    const beforeStart = Date.parse("2026-09-19T23:59:00.000Z");
    const afterStart = Date.parse("2026-09-20T00:00:01.000Z");
    const refreshed: SitePromotionClientView = sampleView("2026-09-27T00:00:00.000Z");

    assert.deepEqual(buildActiveSitePromotionClientViewMap([], beforeStart), {});
    const map = buildActiveSitePromotionClientViewMap([refreshed], afterStart);
    assert.ok(map[MODEL]);
    assert.equal(map[MODEL].badge, "-30%");
  });

});

describe("site promotion client lifecycle server parity", () => {
  installIsolatedTestDatabase();

  it("C: expired promo → server billing normal and client surfaces inactive", () => {
    const start = "2026-09-01T00:00:00.000Z";
    const end = "2026-09-03T00:00:00.000Z";
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "google:lifecycle-expired",
    });

    const expiredAt = Date.parse("2026-09-04T00:00:00.000Z");
    assert.equal(resolveActiveSitePromotion(MODEL, new Date(expiredAt).toISOString()), null);

    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 5_000,
      outputTokens: 1_000,
      apiPromptTokens: 5_000,
      apiCompletionTokens: 1_000,
    });
    assert.equal(billing.sitePromotion, undefined);

    const staleView = toSitePromotionClientView(
      resolveActiveSitePromotion(MODEL, "2026-09-02T00:00:00.000Z")!,
      "Gemini"
    );
    assert.equal(isSitePromotionClientViewActive(staleView, expiredAt), false);
    assert.deepEqual(buildActiveSitePromotionClientViewMap([staleView], expiredAt), {});
  });

  it("D: campaign shorter than 7 days does not claim 7-day copy", () => {
    const start = "2026-09-01T00:00:00.000Z";
    const end = "2026-09-04T00:00:00.000Z";
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "google:short-campaign-copy",
    });

    const promo = resolveActiveSitePromotion(MODEL, "2026-09-02T00:00:00.000Z");
    assert.ok(promo);
    const activatedMs = Date.parse(promo.activatedAt);
    const endsMs = Date.parse(promo.endsAt);
    assert.ok(endsMs - activatedMs < 7 * 24 * 60 * 60 * 1000);

    const copy = formatSitePromotionUserLabel(promo, "Gemini");
    assert.doesNotMatch(copy.subtitle, /7일/);
    assert.match(copy.subtitle, /기간 한정 모델 이용료 30% 할인/);
  });

});

describe("site promotion historical receipt", () => {
  it("E: historical receipt snapshot unchanged after campaign expiry", () => {
    const historicalUsage: Usage = {
      input: 5_000,
      output: 1_000,
      model: MODEL,
      modelLabel: "Gemini",
      route: "safe",
      cost: 35,
      savedOutputChars: 800,
      sitePromotion: {
        baseUserChargePoints: 50,
        siteDiscountPercent: 30,
        siteDiscountPoints: 15,
        finalChargePoints: 35,
        campaignId: 1,
        officialPromotionId: 1,
        episodeKey: "google:hist",
        provider: "google",
        source: "admin",
        provenance: "test",
        appliedAt: "2026-09-02T00:00:00.000Z",
      },
      breakdown: [],
    };
    const receipt = buildPublicBillingReceipt(historicalUsage);
    assert.ok(receipt);
    assert.equal(receipt.siteDiscountPercent, 30);
  });
});
