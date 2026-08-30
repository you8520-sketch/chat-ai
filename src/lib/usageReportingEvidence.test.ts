import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  isValidReportedTokenValue,
  mergeFieldReportingStatus,
  stageUsageReportingEvidenceFromTokenUsage,
  stripUsageReportingEvidenceFromStage,
  type UsageFieldReportingStatus,
} from "@/lib/usageReportingEvidence";

type BaselineFixture = {
  capturedAtRef: string;
  numeric: Record<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      standardInputTokens: number;
      estimated: boolean;
    }
  >;
  liveBilling: Record<string, { total: number; baseCost: number }>;
};

const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/fixtures/openRouterUsageNumericBaseline.json"), "utf8")
) as BaselineFixture;

const NUMERIC_FIXTURE_INPUTS: Record<
  string,
  { raw: Record<string, unknown>; headers?: Record<string, string> }
> = {
  plain: { raw: { prompt_tokens: 100, completion_tokens: 50 } },
  cache_explicit_zero: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
  },
  cache_positive: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 } },
  },
  cache_malformed: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "bad" } },
  },
  gemini_implicit_echo: {
    raw: {
      prompt_tokens: 4541,
      completion_tokens: 1079,
      prompt_tokens_details: { cached_tokens: 4290, cache_write_tokens: 4290 },
    },
  },
  reasoning_positive: {
    raw: { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 4912 } },
  },
  reasoning_explicit_zero: {
    raw: { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 0 } },
  },
  reasoning_malformed_float: {
    raw: { prompt_tokens: 5000, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 5.5 } },
  },
  reasoning_malformed_string_float: {
    raw: { prompt_tokens: 5000, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: "5.5" } },
  },
  mixed_cache_valid_invalid: {
    raw: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: "bad", cache_read_tokens: 12 },
    },
  },
  mixed_cache_float_and_zero: {
    raw: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 5.5, cache_read_tokens: 0 },
    },
  },
  header_body_mixed: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 5 } },
    headers: { "x-cache-read-tokens": "20" },
  },
  header_malformed_body_valid: {
    raw: { prompt_tokens: 100, completion_tokens: 50 },
    headers: { "x-cache-read-tokens": "bad", "x-anthropic-cache-read-input-tokens": "20" },
  },
  empty_string_cache: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "" } },
  },
  whitespace_string_cache: {
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "   " } },
  },
};

const LIVE_BILLING_INPUTS = {
  G37: {
    provider: "cheaperinference" as const,
    openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    inputTokens: 24_952,
    outputTokens: 2367,
  },
  G31_OR: {
    provider: "openrouter" as const,
    openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    inputTokens: 40_689,
    outputTokens: 4307,
  },
  G31_CI: {
    provider: "cheaperinference" as const,
    openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    inputTokens: 40_689,
    outputTokens: 4307,
  },
  Opus5: {
    provider: "openrouter" as const,
    openRouterModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    inputTokens: 63_749,
    outputTokens: 3629,
    reasoningTokens: 800,
  },
};

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

function resolveCandidateFromRaw(raw: Record<string, unknown>) {
  const rawWithCache = {
    prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
    ...raw,
  };
  const stage = productionStageFromRaw(rawWithCache);
  const candidate = resolveTurnBillableUsage({
    stages: [stage],
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
  });
  return candidate;
}

describe("usageReportingEvidence — evidence validity rules", () => {
  it("empty and whitespace strings are not valid explicit zero", () => {
    for (const raw of ["", " ", "\t"]) {
      assert.equal(isValidReportedTokenValue(raw), false, JSON.stringify(raw));
    }
    for (const raw of ["0", "00", " 0 "]) {
      assert.equal(isValidReportedTokenValue(raw), true, JSON.stringify(raw));
    }
  });

  it("mergeFieldReportingStatus — invalid dominates valid", () => {
    assert.equal(
      mergeFieldReportingStatus("reported_valid", "reported_invalid"),
      "reported_invalid"
    );
    assert.equal(
      mergeFieldReportingStatus("reported_invalid", "unreported"),
      "reported_invalid"
    );
  });

  it("stripUsageReportingEvidenceFromStage removes runtime-only evidence", () => {
    const stripped = stripUsageReportingEvidenceFromStage({
      stage: "primary",
      model: "x",
      input: 1,
      output: 2,
      cost: 3,
      usageReportingEvidence: {
        cacheRead: "reported_valid",
        cacheWrite: "unreported",
        reasoning: "unreported",
      },
    });
    assert.equal("usageReportingEvidence" in stripped, false);
    assert.equal(stripped.cost, 3);
  });
});

describe("usageReportingEvidence — BASE vs HEAD live billing parity", () => {
  for (const [id, expected] of Object.entries(BASELINE.liveBilling)) {
    it(`${id} matches base main live billing snapshot`, () => {
      const input = LIVE_BILLING_INPUTS[id as keyof typeof LIVE_BILLING_INPUTS];
      assert.ok(input);
      const r = computeTurnBilling({
        ...input,
        apiPromptTokens: input.inputTokens,
        apiCompletionTokens: input.outputTokens,
      });
      assert.equal(r.total, expected.total);
      assert.equal(r.baseCost, expected.baseCost);
    });
  }
});

describe("usageReportingEvidence — BASE vs HEAD numeric parity", () => {
  assert.equal(BASELINE.capturedAtRef, "2eacc0cc5f8f7561a50a906a595057c56d743b2e");

  for (const [id, expected] of Object.entries(BASELINE.numeric)) {
    it(`${id} matches base main numeric snapshot`, () => {
      const input = NUMERIC_FIXTURE_INPUTS[id];
      assert.ok(input, `missing fixture input for ${id}`);
      const headers = input.headers ? new Headers(input.headers) : undefined;
      const b = parseOpenRouterUsage(input.raw, headers);
      assert.deepEqual(
        {
          promptTokens: b.promptTokens,
          completionTokens: b.completionTokens,
          reasoningTokens: b.reasoningTokens,
          cacheReadTokens: b.cacheReadTokens,
          cacheWriteTokens: b.cacheWriteTokens,
          standardInputTokens: b.standardInputTokens,
          estimated: b.estimated,
        },
        expected
      );
    });
  }
});

describe("usageReportingEvidence — mixed-source false-exact prevention", () => {
  it("mixed valid+invalid cache read → reported_invalid", () => {
    const evidence = detectOpenRouterUsageReportingEvidence({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: "bad", cache_read_tokens: 12 },
    });
    assert.equal(evidence.cacheRead, "reported_invalid");
  });

  it("mixed float+zero cache read → reported_invalid", () => {
    const evidence = detectOpenRouterUsageReportingEvidence({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 5.5, cache_read_tokens: 0 },
    });
    assert.equal(evidence.cacheRead, "reported_invalid");
  });

  it("mixed malformed header + valid header → reported_invalid", () => {
    const evidence = detectOpenRouterUsageReportingEvidence(
      { prompt_tokens: 100, completion_tokens: 50 },
      new Headers({ "x-cache-read-tokens": "bad", "x-anthropic-cache-read-input-tokens": "20" })
    );
    assert.equal(evidence.cacheRead, "reported_invalid");
  });

  it("mixed reasoning aliases with float + zero → reported_invalid", () => {
    const evidence = detectOpenRouterUsageReportingEvidence({
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 5.5, reasoning: 0 },
    });
    assert.equal(evidence.reasoning, "reported_invalid");
  });
});

describe("usageReportingEvidence — malformed positive reasoning adversarial", () => {
  for (const partial of [
    { completion_tokens_details: { reasoning_tokens: 5.5 } },
    { completion_tokens_details: { reasoning_tokens: "5.5" } },
    { completion_tokens_details: { reasoning_tokens: true } },
  ]) {
    it(`malformed reasoning ${JSON.stringify(partial)} cannot become PROVIDER_REPORTED_EXACT`, () => {
      const raw = {
        prompt_tokens: 5000,
        completion_tokens: 400,
        prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
        ...partial,
      };
      const parsed = parseOpenRouterUsage(raw);
      assert.ok(parsed.reasoningTokens > 0, "legacy numeric rounds malformed positive");
      assert.equal(parsed.reportingEvidence.reasoning, "reported_invalid");
      const candidate = resolveCandidateFromRaw(raw);
      assert.equal(candidate.diagnostics.fieldSources.reasoning, "SANITIZED_MALFORMED");
      assert.notEqual(candidate.diagnostics.fieldSources.reasoning, "PROVIDER_REPORTED_EXACT");
      assert.notEqual(candidate.usageCoverage, "complete");
    });
  }

  it("negative reasoning is invalid and does not become exact", () => {
    const raw = {
      prompt_tokens: 5000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
      completion_tokens_details: { reasoning_tokens: -1 },
    };
    const parsed = parseOpenRouterUsage(raw);
    assert.equal(parsed.reasoningTokens, 0);
    assert.equal(parsed.reportingEvidence.reasoning, "reported_invalid");
    const candidate = resolveCandidateFromRaw(raw);
    assert.equal(candidate.diagnostics.fieldSources.reasoning, "SANITIZED_MALFORMED");
  });
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

  it("explicit valid zero cache/reasoning → complete", () => {
    const stage = productionStageFromRaw({
      prompt_tokens: 5000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    });
    const r = resolveTurnBillableUsage({ stages: [stage], modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    assert.equal(r.diagnostics.fieldSources.cacheRead, fieldSourceExpectations.reported_valid);
    assert.equal(r.diagnostics.fieldSources.cacheWrite, fieldSourceExpectations.reported_valid);
    assert.equal(r.diagnostics.fieldSources.reasoning, fieldSourceExpectations.reported_valid);
    assert.equal(r.usageCoverage, "complete");
  });

  it("mixed invalid cache cannot reach complete", () => {
    const stage = productionStageFromRaw({
      prompt_tokens: 5000,
      completion_tokens: 400,
      prompt_tokens_details: { cached_tokens: "bad", cache_read_tokens: 12 },
      completion_tokens_details: { reasoning_tokens: 0 },
    });
    const r = resolveTurnBillableUsage({ stages: [stage], modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    assert.equal(r.diagnostics.fieldSources.cacheRead, "SANITIZED_MALFORMED");
    assert.equal(r.usageCoverage, "partial");
  });

  it("absent cache must not become complete", () => {
    const stage = productionStageFromRaw({ prompt_tokens: 5000, completion_tokens: 400 });
    const r = resolveTurnBillableUsage({ stages: [stage], modelId: OPENROUTER_GEMINI_31_PRO_MODEL });
    assert.equal(r.usageCoverage, "partial");
    assert.equal(r.diagnostics.fieldSources.cacheRead, "MISSING_AND_UNKNOWN");
  });
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
  });
});

describe("usageReportingEvidence — regression guards", () => {
  it("R1 absent cache not mistaken for explicit zero", () => {
    const parsed = parseOpenRouterUsage({ prompt_tokens: 100, completion_tokens: 50 });
    assert.equal(parsed.reportingEvidence.cacheRead, "unreported");
  });

  it("R8 header/body numeric max semantics unchanged on valid-only sources", () => {
    const parsed = parseOpenRouterUsage(
      { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 5 } },
      new Headers({ "x-cache-read-tokens": "20" })
    );
    assert.equal(parsed.cacheReadTokens, 20);
    assert.equal(parsed.reportingEvidence.cacheRead, "reported_valid");
  });
});
