import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL,
  BILLING_BREAKDOWN_SYSTEM_RULES_LABEL,
  canShowFullBillingReceipt,
  filterUsageBreakdownForReceipt,
  sanitizeUsageForPublicReceipt,
  stripAdultRoutingForClient,
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
      statusWidgetExtractDiagnostics: {
        exhausted: true,
        usedFallback: false,
        attempts: [
          {
            stage: "initial",
            modelId: "deepseek-v4-flash",
            httpStatus: 503,
            finishReason: null,
            errorCode: "CompatibleCompletionError",
          },
        ],
      },
      widgetCostPoints: 3,
      exchangeRateKrwPerUsd: 1400,
      exchangeRateDateKey: "2026-01-01",
      breakdownAllocation: "estimated_section_allocation",
      assembledPromptChars: {
        system: 100,
        systemRules: 40,
        characterSettings: 30,
        dynamic: 20,
        history: 50,
        currentUser: 10,
        total: 160,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.assembledPromptChars, undefined);
    assert.equal(sanitized.breakdownAllocation, undefined);
    assert.equal(sanitized.statusWidgetExtract, undefined);
    assert.equal(sanitized.statusWidgetExtractDiagnostics, undefined);
    assert.equal(sanitized.widgetCostPoints, undefined);
    assert.equal(sanitized.exchangeRateKrwPerUsd, undefined);
    assert.equal(sanitized.breakdown.length, 0);
  });

  it("preserves finishReason and smoke max-token telemetry on public sanitize", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "deepseek/deepseek-v4-pro",
      route: "safe" as const,
      cost: 1,
      breakdown: [],
      finishReason: "length",
      requestedMaxTokens: 4096,
      effectiveMaxTokens: 4096,
      targetResponseChars: 2200,
      statusWidgetExtract: {
        model: "x",
        modelLabel: "widget",
        input: 1,
        output: 1,
        apiRawCostKrw: 3,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.finishReason, "length");
    assert.equal(sanitized.requestedMaxTokens, 4096);
    assert.equal(sanitized.effectiveMaxTokens, 4096);
    assert.equal(sanitized.targetResponseChars, 2200);
    assert.equal(sanitized.statusWidgetExtract, undefined);
  });

  it("strips museAcceptance from public sanitize (defense in depth)", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "meta/muse-spark-1.1",
      route: "nsfw" as const,
      cost: 1,
      breakdown: [],
      museAcceptance: { acceptanceClass: "SHORT_QUALITY_PASS", visibleChars: 1200 },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.museAcceptance, undefined);
  });

  it("strips English-layer admin metadata from public receipts", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "deepseek-v4-pro-0813",
      route: "safe" as const,
      cost: 1,
      breakdown: [],
      usedEnglishCharacterPrompt: true,
      characterPromptLanguage: "english",
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.usedEnglishCharacterPrompt, undefined);
    assert.equal(sanitized.characterPromptLanguage, undefined);
  });

  it("rewrites handoff identity to the selected model and strips adultRouting for public", () => {
    const usage = {
      input: 10,
      output: 20,
      model: "qwen-3-8-max",
      modelLabel: "Qwen 3.8 Max",
      selectedAI: "qwen-3-8-max",
      provider: "cheaperinference" as const,
      route: "nsfw" as const,
      cost: 12,
      breakdown: [],
      stages: [
        { stage: "adult", model: "qwen-3-8-max", input: 10, output: 20, cost: 12 },
      ],
      adultRouting: {
        activeRoute: "adult" as const,
        actualModel: "qwen-3-8-max",
        actualProvider: "cheaperinference",
        userSelectedModel: "claude-opus-5",
        userSelectedModelLabel: "Claude Opus 5",
        userSelectedProvider: "cheaperinference" as const,
        glmHardFailureReason: "hidden",
        hiddenFallbackOverheadCostUsd: 0.2,
      },
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.model, "claude-opus-5");
    assert.equal(sanitized.modelLabel, "Claude Opus 5");
    assert.equal(sanitized.selectedAI, "claude-opus-5");
    assert.equal(sanitized.adultRouting, undefined);
    assert.equal(sanitized.cost, 12);
    const client = stripAdultRoutingForClient(usage);
    assert.equal(client.selectedAI, "claude-opus-5");
    assert.equal(client.adultRouting, undefined);
    const admin = stripAdultRoutingForClient(usage, { keepInternal: true });
    assert.equal(admin.adultRouting?.actualModel, "qwen-3-8-max");
    assert.equal(admin.modelLabel, "Claude Opus 5");
  });

  it("strips generationKind/canonical from public receipts", () => {
    const usage = {
      input: 1,
      output: 2,
      model: "claude-opus-5",
      route: "safe" as const,
      cost: 4,
      breakdown: [],
      generationKind: "ooc_scene_render" as const,
      canonical: false,
    } satisfies Usage;
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.generationKind, undefined);
    assert.equal(sanitized.canonical, undefined);
  });
});
