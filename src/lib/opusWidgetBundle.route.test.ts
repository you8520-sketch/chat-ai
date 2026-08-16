import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeUrl = new URL("../app/api/chat/route.ts", import.meta.url);

describe("production chat route Opus widget bundle", () => {
  it("uses both full-receipt and fallback widget paths with the same bundle flag", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(src, /applyStatusWidgetBillingCharge\(/);
    assert.match(src, /applyStatusWidgetFallbackReceiptCharge\(/);
    assert.match(
      src,
      /applyStatusWidgetBillingCharge\([\s\S]*bundleIntoMainCharge:\s*isOpusTierPricedModel\(deliveredModelId\)/
    );
    assert.match(
      src,
      /applyStatusWidgetFallbackReceiptCharge\([\s\S]*bundleIntoMainCharge:\s*isOpusTierPricedModel\(deliveredModelId\)/
    );
  });

  it("deducts the already-bundled cost once", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(src, /const deducted = deductPoints\(\s*user\.id,\s*cost,/);
    assert.doesNotMatch(src, /deductPoints\([\s\S]{0,80}cost\s*\+\s*widgetCostPoints/);
    assert.doesNotMatch(src, /deductPoints\([\s\S]{0,80}widgetCostPoints/);
  });

  it("attaches widget accounting fields before public sanitize", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.match(src, /applyStatusWidgetFallbackReceiptCharge\(/);
    assert.match(src, /sanitizeUsageForPublicReceipt\(usageRecord\)/);
    assert.match(src, /usageJson:\s*JSON\.stringify\(dbUsageRecord\)/);
  });
});
