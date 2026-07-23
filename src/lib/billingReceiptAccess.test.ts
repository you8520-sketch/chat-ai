import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL,
  BILLING_BREAKDOWN_SYSTEM_RULES_LABEL,
  canShowFullBillingReceipt,
  filterUsageBreakdownForReceipt,
  sanitizeUsageForPublicReceipt,
} from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";

describe("canShowFullBillingReceipt", () => {
  it("does not expose operational pricing details to non-admin demo accounts", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "demo@example.com", is_admin: 0 }),
      false
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

  it("keeps keyword lorebook line for public receipts", () => {
    const breakdown = [
      { label: BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL, tokens: 40, pct: 20 },
      { label: BILLING_BREAKDOWN_SYSTEM_RULES_LABEL, tokens: 60, pct: 30 },
      { label: "선택 페르소나", tokens: 100, pct: 50 },
    ];
    const filtered = filterUsageBreakdownForReceipt(breakdown, false);
    assert.deepEqual(
      filtered.map((b) => b.label),
      [BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL, "선택 페르소나"]
    );
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
