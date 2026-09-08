import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("BillingReceiptTooltip admin receipt fetch boundary", () => {
  it("guards the admin endpoint behind the full-receipt capability and preserves that fetch path", () => {
    const source = readFileSync("src/components/BillingReceiptTooltip.tsx", "utf8");
    const guard = source.indexOf("if (!open || !showFullReceipt || !messageId) return;");
    const endpoint = source.indexOf("/api/chat/admin-billing-receipt?messageId=${messageId}");

    assert.ok(guard >= 0, "admin fetch must require an open full receipt with a message id");
    assert.ok(endpoint > guard, "normal receipt UI must not reach the admin endpoint fetch");
    assert.match(source, /showFullReceipt \? \(/, "admin full receipt rendering remains available");
  });
});
