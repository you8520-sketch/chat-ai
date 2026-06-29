import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BILLING_BREAKDOWN_SYSTEM_RULES_LABEL,
  canShowFullBillingReceipt,
  filterUsageBreakdownForReceipt,
  sanitizeUsageForPublicReceipt,
} from "@/lib/billingReceiptAccess";
import { DEMO_USER_EMAIL } from "@/lib/demo";
import type { Usage } from "@/lib/chatUsage";

describe("canShowFullBillingReceipt", () => {
  it("allows demo user email", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: DEMO_USER_EMAIL, is_admin: 0 }),
      true
    );
  });

  it("allows admin flag", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 1 }),
      true
    );
  });

  it("denies regular users", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 0 }),
      false
    );
  });

  it("filters system rules from public breakdown", () => {
    const breakdown = [
      { label: "캐릭터 프롬프트", tokens: 100, pct: 50 },
      { label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 100, pct: 50 },
    ];
    const filtered = filterUsageBreakdownForReceipt(breakdown, false);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.label, "캐릭터 프롬프트");
  });

  it("strips widget and exchange fields for public receipt", () => {
    const usage = {
      input: 1,
      output: 2,
      model: "test",
      route: "safe" as const,
      cost: 10,
      breakdown: [{ label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 5, pct: 100 }],
      statusWidgetExtract: {
        model: "x",
        modelLabel: "widget",
        input: 1,
        output: 1,
        apiRawCostKrw: 3,
      },
      widgetCostPoints: 3,
      exchangeRateKrwPerUsd: 1400,
      exchangeRateDateKey: "2026-01-01",
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.statusWidgetExtract, undefined);
    assert.equal(sanitized.widgetCostPoints, undefined);
    assert.equal(sanitized.exchangeRateKrwPerUsd, undefined);
    assert.equal(sanitized.breakdown.length, 0);
  });
});
