import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "@/lib/chatModels";
import { createOfficialProviderPromotion } from "@/lib/officialProviderPromotion";
import { computeOpenRouterTurnBilling } from "@/lib/pointsReasoningMargins";
import { buildPublicBillingReceipt } from "@/lib/publicBillingReceipt";
import { getActiveHomePopupNotice } from "@/lib/homePopupNotice";
import {
  formatSitePromotionUserLabel,
  resolveActiveSitePromotion,
  resolveActiveSitePromotionsForModels,
  toSitePromotionClientView,
} from "@/lib/sitePromotion";
import { computeSiteDiscountPercent } from "@/lib/sitePromotionPolicy";
import type { Usage } from "@/lib/chatUsage";

const MODEL = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;

describe("site promotion display single source", () => {
  installIsolatedTestDatabase();

  it("official verified/active 50% → billing, receipt, badge, notice all 30%", () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "google:display-parity",
    });

    const promo = resolveActiveSitePromotion(MODEL);
    assert.ok(promo);
    assert.equal(promo.siteDiscountPercent, 30);

    const billing = computeOpenRouterTurnBilling({
      modelId: MODEL,
      inputTokens: 10_000,
      outputTokens: 2_000,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 2_000,
    });
    assert.equal(billing.sitePromotion?.siteDiscountPercent, 30);

    const usage: Usage = {
      input: 10_000,
      output: 2_000,
      model: MODEL,
      modelLabel: "Gemini 3.1 Pro Preview",
      route: "safe",
      cost: billing.total,
      provider: "cheaperinference",
      savedOutputChars: 1200,
      apiInputTokens: 10_000,
      apiOutputTokens: 2_000,
      sitePromotion: billing.sitePromotion,
      breakdown: [],
    };
    const receipt = buildPublicBillingReceipt(usage);
    assert.ok(receipt);
    assert.equal(receipt.siteDiscountPercent, 30);

    const clientView = toSitePromotionClientView(promo, "Gemini 3.1 Pro Preview");
    assert.equal(clientView.badge, "-30%");
    assert.match(clientView.subtitle, /30%/);
    assert.equal(clientView.siteDiscountPercent, 30);
  });

  it("promotion expiry hides active promo; historical receipt snapshot unchanged", () => {
    const start = "2026-09-01T00:00:00.000Z";
    const end = "2026-09-08T00:00:00.000Z";
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "google:expiry-display",
    });

    const active = resolveActiveSitePromotion(MODEL, "2026-09-02T00:00:00.000Z");
    assert.ok(active);
    const expired = resolveActiveSitePromotion(MODEL, "2026-09-09T00:00:00.000Z");
    assert.equal(expired, null);
    assert.equal(resolveActiveSitePromotionsForModels([MODEL], "2026-09-09T00:00:00.000Z").length, 0);

    const historicalUsage: Usage = {
      input: 5_000,
      output: 1_000,
      model: MODEL,
      modelLabel: "Gemini 3.1 Pro Preview",
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
        episodeKey: "google:expiry-display",
        provider: "google",
        source: "admin",
        provenance: "test",
        appliedAt: "2026-09-02T00:00:00.000Z",
      },
      breakdown: [],
    };
    const historicalReceipt = buildPublicBillingReceipt(historicalUsage);
    assert.ok(historicalReceipt);
    assert.equal(historicalReceipt.siteDiscountPercent, 30);
  });

  it("manual home popup notice is independent from site promotion surfaces", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO home_popup_notices (id, enabled, title, content, background_color, image_url, updated_at)
       VALUES (1, 1, 'Manual admin notice', 'Do not overwrite me', '#21183a', '', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         enabled=excluded.enabled,
         title=excluded.title,
         content=excluded.content,
         updated_at=datetime('now')`
    ).run();

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    createOfficialProviderPromotion({
      provider: "google",
      modelId: MODEL,
      officialDiscountPct: 50,
      officialStart: start,
      officialEnd: end,
      verifiedAt: start,
      episodeKey: "google:manual-notice-coexist",
    });

    const manual = getActiveHomePopupNotice(db);
    assert.ok(manual);
    assert.equal(manual.title, "Manual admin notice");
    assert.ok(resolveActiveSitePromotion(MODEL));
    assert.match(formatSitePromotionUserLabel(resolveActiveSitePromotion(MODEL)!).subtitle, /30%/);
  });
});

describe("site promotion discount examples", () => {
  it("canonical nearest-10 mapping table", () => {
    assert.equal(computeSiteDiscountPercent(30), 20);
    assert.equal(computeSiteDiscountPercent(40), 20);
    assert.equal(computeSiteDiscountPercent(50), 30);
    assert.equal(computeSiteDiscountPercent(60), 40);
  });
});
