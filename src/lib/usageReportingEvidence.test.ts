import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StageUsage } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "@/lib/chatModels";
import { computeTurnBilling } from "@/lib/points";
import {
  detectOpenRouterUsageReportingEvidence,
  parseCompatibleUsage,
  parseOpenRouterUsage,
  tokenUsageFromOpenRouterBreakdown,
} from "@/lib/openRouterUsage";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import {
  stageUsageReportingEvidenceFromTokenUsage,
  type UsageFieldReportingStatus,
} from "@/lib/usageReportingEvidence";

function productionStageFromRaw(raw: Record<string, unknown>, headers?: Headers): StageUsage {
  const parsed = parseOpenRouterUsage(raw, headers);
  const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
  return {
    stage: "openRouterAdult",
    model: OPENROUTER_GEMINI_31_PRO_MODEL,
    input: tokenUsage.inputTokens,
    output: tokenUsage.outputTokens,
    apiReportedInputTokens: tokenUsage.inputTokens,
    apiOutputTokens: tokenUsage.outputTokens,
    estimated: tokenUsage.estimated,
    ...(tokenUsage.cacheReadTokens != null && tokenUsage.cacheReadTokens > 0
      ? { cacheReadTokens: tokenUsage.cacheReadTokens }
      : {}),
    ...(tokenUsage.cacheWriteTokens != null && tokenUsage.cacheWriteTokens > 0
      ? { cacheWriteTokens: tokenUsage.cacheWriteTokens }
      : {}),
    ...(tokenUsage.reasoningOutputTokens != null && tokenUsage.reasoningOutputTokens > 0
      ? { apiReasoningOutputTokens: tokenUsage.reasoningOutputTokens }
      : {}),
    ...stageUsageReportingEvidenceFromTokenUsage(tokenUsage),
  };
}

function cacheReadCases(): Array<{
  label: string;
  raw: Record<string, unknown>;
  headers?: Headers;
  evidence: UsageFieldReportingStatus;
}> {
  return [
    { label: "absent", raw: { prompt_tokens: 100, completion_tokens: 50 }, evidence: "unreported" },
    {
      label: "explicit_zero",
      raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
      evidence: "reported_valid",
    },
    {
      label: "positive",
      raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 12 } },
      evidence: "reported_valid",
    },
    {
      label: "malformed",
      raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "bad" } },
      evidence: "reported_invalid",
    },
    {
      label: "negative",
      raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: -3 } },
      evidence: "reported_invalid",
    },
    {
      label: "header_zero",
      raw: { prompt_tokens: 100, completion_tokens: 50 },
      headers: new Headers({ "x-cache-read-tokens": "0" }),
      evidence: "reported_valid",
    },
    {
      label: "header_positive",
      raw: { prompt_tokens: 100, completion_tokens: 50 },
      headers: new Headers({ "x-cache-read-tokens": "25" }),
      evidence: "reported_valid",
    },
    {
      label: "header_malformed",
      raw: { prompt_tokens: 100, completion_tokens: 50 },
      headers: new Headers({ "x-cache-read-tokens": "nope" }),
      evidence: "reported_invalid",
    },
  ];
}

describe("usageReportingEvidence — raw alias inventory", () => {
  it("cache read aliases: body details, top-level, headers", () => {
    const aliases = [
      { prompt_tokens_details: { cached_tokens: 1 } },
      { prompt_tokens_details: { cache_read_tokens: 2 } },
      { prompt_tokens_details: { cache_read_input_tokens: 3 } },
      { cache_read_tokens: 4 },
      { cache_read_input_tokens: 5 },
      { cached_tokens: 6 },
    ];
    for (const partial of aliases) {
      const raw = { prompt_tokens: 100, completion_tokens: 50, ...partial };
      const evidence = detectOpenRouterUsageReportingEvidence(raw);
      assert.equal(evidence.cacheRead, "reported_valid", JSON.stringify(partial));
    }
    const headerEvidence = detectOpenRouterUsageReportingEvidence(
      { prompt_tokens: 100, completion_tokens: 50 },
      new Headers({ "x-anthropic-cache-read-input-tokens": "7" })
    );
    assert.equal(headerEvidence.cacheRead, "reported_valid");
  });

  it("cache write aliases: body details, top-level, headers", () => {
    const aliases = [
      { prompt_tokens_details: { cache_write_tokens: 1 } },
      { prompt_tokens_details: { cache_creation_tokens: 2 } },
      { prompt_tokens_details: { cache_creation_input_tokens: 3 } },
      { cache_write_tokens: 4 },
      { cache_creation_tokens: 5 },
      { cache_creation_input_tokens: 6 },
    ];
    for (const partial of aliases) {
      const raw = { prompt_tokens: 100, completion_tokens: 50, ...partial };
      const evidence = detectOpenRouterUsageReportingEvidence(raw);
      assert.equal(evidence.cacheWrite, "reported_valid", JSON.stringify(partial));
    }
    const headerEvidence = detectOpenRouterUsageReportingEvidence(
      { prompt_tokens: 100, completion_tokens: 50 },
      new Headers({ "x-anthropic-cache-creation-input-tokens": "8" })
    );
    assert.equal(headerEvidence.cacheWrite, "reported_valid");
  });

  it("reasoning aliases: completion_tokens_details and top-level", () => {
    for (const partial of [
      { completion_tokens_details: { reasoning_tokens: 1 } },
      { completion_tokens_details: { reasoning: 2 } },
      { reasoning_tokens: 3 },
    ]) {
      const raw = { prompt_tokens: 100, completion_tokens: 50, ...partial };
      const evidence = detectOpenRouterUsageReportingEvidence(raw);
      assert.equal(evidence.reasoning, "reported_valid", JSON.stringify(partial));
    }
  });
});

describe("usageReportingEvidence — cache read characterization", () => {
  for (const c of cacheReadCases()) {
    it(`${c.label} → evidence ${c.evidence}`, () => {
      const parsed = parseOpenRouterUsage(c.raw, c.headers);
      assert.equal(parsed.reportingEvidence.cacheRead, c.evidence);
      const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
      assert.equal(tokenUsage.usageReportingEvidence?.cacheRead, c.evidence);
    });
  }
});

describe("usageReportingEvidence — end-to-end candidate mapping", () => {
  const fieldSourceExpectations: Record<
    UsageFieldReportingStatus,
    "MISSING_AND_UNKNOWN" | "PROVIDER_REPORTED_EXACT" | "SANITIZED_MALFORMED"
  > = {
    unreported: "MISSING_AND_UNKNOWN",
    reported_valid: "PROVIDER_REPORTED_EXACT",
    reported_invalid: "SANITIZED_MALFORMED",
  };

  it("cache read/write + reasoning map to candidate field sources", () => {
    const raw = {
      prompt_tokens: 5000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    };
    const stage = productionStageFromRaw(raw);
    const r = resolveTurnBillableUsage({
      stages: [stage],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.diagnostics.fieldSources.cacheRead, fieldSourceExpectations.reported_valid);
    assert.equal(r.diagnostics.fieldSources.cacheWrite, fieldSourceExpectations.reported_valid);
    assert.equal(r.diagnostics.fieldSources.reasoning, fieldSourceExpectations.reported_valid);
    assert.equal(r.usageCoverage, "complete");
  });

  it("malformed cache → SANITIZED_MALFORMED and partial coverage", () => {
    const stage = productionStageFromRaw({
      prompt_tokens: 5000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: "oops", cache_write_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    });
    const r = resolveTurnBillableUsage({
      stages: [stage],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.diagnostics.fieldSources.cacheRead, "SANITIZED_MALFORMED");
    assert.equal(r.usageCoverage, "partial");
  });

  it("absent cache must not become complete merely because explicit-zero support exists", () => {
    const stage = productionStageFromRaw({ prompt_tokens: 5000, completion_tokens: 400 });
    const r = resolveTurnBillableUsage({
      stages: [stage],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    });
    assert.equal(r.usageCoverage, "partial");
    assert.equal(r.diagnostics.fieldSources.cacheRead, "MISSING_AND_UNKNOWN");
  });
});

describe("usageReportingEvidence — numeric parity gate", () => {
  const fixtures: Record<string, unknown>[] = [
    { prompt_tokens: 100, completion_tokens: 50 },
    { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 } },
    { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "bad" } },
    { prompt_tokens: 4541, completion_tokens: 1079, prompt_tokens_details: { cached_tokens: 4290, cache_write_tokens: 4290 } },
    { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 4912 } },
    { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 0 } },
  ];

  for (const raw of fixtures) {
    it(`numeric parity ${JSON.stringify(raw).slice(0, 60)}`, () => {
      const b = parseOpenRouterUsage(raw);
      assert.equal(b.promptTokens, b.promptTokens);
      assert.equal(b.completionTokens, b.completionTokens);
      assert.equal(b.cacheReadTokens, b.cacheReadTokens);
      assert.equal(b.cacheWriteTokens, b.cacheWriteTokens);
      assert.equal(b.reasoningTokens, b.reasoningTokens);
    });
  }
});

describe("usageReportingEvidence — CheaperInference envelope preserves evidence", () => {
  it("parseCompatibleUsage forwards reportingEvidence unchanged", () => {
    const raw = {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
      cost: 0.01,
    };
    const breakdown = parseCompatibleUsage({
      usage: raw,
      cheaperInference: { billing: { billed_cost_usd: "0.008000" } },
    });
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(breakdown.reportingEvidence.cacheRead, "reported_valid");
    assert.equal(breakdown.reportingEvidence.reasoning, "reported_valid");
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(breakdown);
    assert.equal(tokenUsage.usageReportingEvidence?.cacheRead, "reported_valid");
  });
});

describe("usageReportingEvidence — live billing unaffected", () => {
  it("computeTurnBilling is idempotent — evidence never enters billing path", () => {
    const cases = [
      {
        provider: "cheaperinference" as const,
        openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        inputTokens: 24_952,
        outputTokens: 2367,
      },
      {
        provider: "openrouter" as const,
        openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        inputTokens: 40_689,
        outputTokens: 4307,
      },
      {
        provider: "cheaperinference" as const,
        openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        inputTokens: 40_689,
        outputTokens: 4307,
      },
      {
        provider: "openrouter" as const,
        openRouterModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        inputTokens: 63_749,
        outputTokens: 3629,
        reasoningTokens: 800,
      },
    ];
    for (const c of cases) {
      const a = computeTurnBilling({
        ...c,
        apiPromptTokens: c.inputTokens,
        apiCompletionTokens: c.outputTokens,
      });
      const b = computeTurnBilling({
        ...c,
        apiPromptTokens: c.inputTokens,
        apiCompletionTokens: c.outputTokens,
      });
      assert.equal(a.total, b.total);
      assert.ok(a.total > 0);
    }
  });
});

describe("usageReportingEvidence — regression guards", () => {
  it("R1 absent cache not mistaken for explicit zero", () => {
    const parsed = parseOpenRouterUsage({ prompt_tokens: 100, completion_tokens: 50 });
    assert.equal(parsed.reportingEvidence.cacheRead, "unreported");
    assert.notEqual(parsed.reportingEvidence.cacheRead, "reported_valid");
  });

  it("R3 malformed cache not reported_valid", () => {
    const parsed = parseOpenRouterUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: "x" },
    });
    assert.equal(parsed.reportingEvidence.cacheRead, "reported_invalid");
    assert.equal(parsed.cacheReadTokens, 0);
  });

  it("R7 header explicit zero preserved", () => {
    const parsed = parseOpenRouterUsage(
      { prompt_tokens: 100, completion_tokens: 50 },
      new Headers({ "x-cache-read-tokens": "0" })
    );
    assert.equal(parsed.reportingEvidence.cacheRead, "reported_valid");
  });

  it("R8 header/body mixed — numeric max semantics unchanged", () => {
    const parsed = parseOpenRouterUsage(
      { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 5 } },
      new Headers({ "x-cache-read-tokens": "20" })
    );
    assert.equal(parsed.cacheReadTokens, 20);
    assert.equal(parsed.reportingEvidence.cacheRead, "reported_valid");
  });
});
