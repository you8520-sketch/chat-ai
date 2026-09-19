import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySitePromotionToCharge,
  computeRawSiteDiscountPercent,
  computeSiteDiscountPercent,
  computeSiteCampaignEndsAt,
  resolveSiteCampaignActivatedAt,
} from "@/lib/sitePromotionPolicy";

describe("site promotion discount policy rounding (nearest 10%)", () => {
  it("maps official discounts to nearest 10% site discount", () => {
    assert.equal(computeSiteDiscountPercent(30), 20);
    assert.equal(computeSiteDiscountPercent(40), 20);
    assert.equal(computeSiteDiscountPercent(50), 30);
    assert.equal(computeSiteDiscountPercent(60), 40);
    assert.equal(computeSiteDiscountPercent(70), 40);
  });

  it("raw pass-through is official × 0.6 before 10% rounding", () => {
    assert.equal(computeRawSiteDiscountPercent(50), 30);
    assert.equal(computeRawSiteDiscountPercent(40), 24);
  });
});

describe("site promotion point charge rounding", () => {
  it("never over-discounts below advertised percent due to integer ceil on discount points", () => {
    for (const base of [1, 2, 3, 21]) {
      const adj = applySitePromotionToCharge(base, 30);
      assert.equal(adj.finalChargePoints, Math.ceil(base * 0.7 - 1e-9));
      assert.equal(adj.siteDiscountPoints, base - adj.finalChargePoints);
      assert.ok(adj.finalChargePoints >= Math.ceil(base * 0.7 - 1e-9));
      assert.ok(adj.siteDiscountPoints <= Math.floor(base * 0.3 + 1e-9));
    }
  });

  it("base 21P at 30% promo → final 15P / discount 6P", () => {
    const adj = applySitePromotionToCharge(21, 30);
    assert.equal(adj.finalChargePoints, 15);
    assert.equal(adj.siteDiscountPoints, 6);
  });

  it("base 1P at 30% promo does not wipe charge via over-rounding", () => {
    const adj = applySitePromotionToCharge(1, 30);
    assert.equal(adj.finalChargePoints, 1);
    assert.equal(adj.siteDiscountPoints, 0);
  });
});

describe("site promotion campaign activation timing", () => {
  it("future officialStart delays campaign activation", () => {
    const activatedAt = resolveSiteCampaignActivatedAt(
      "2026-09-20T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z"
    );
    assert.equal(activatedAt, "2026-10-01T00:00:00.000Z");
    const endsAt = computeSiteCampaignEndsAt(activatedAt, "2026-11-01T00:00:00.000Z");
    assert.equal(endsAt, "2026-10-08T00:00:00.000Z");
  });

  it("late verification uses verifiedAt when after officialStart", () => {
    const activatedAt = resolveSiteCampaignActivatedAt(
      "2026-09-20T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z"
    );
    assert.equal(activatedAt, "2026-09-20T00:00:00.000Z");
  });
});
