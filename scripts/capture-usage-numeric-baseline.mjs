/**
 * Capture parseOpenRouterUsage numeric outputs at a fixed git ref for BASE-vs-HEAD parity.
 * Uses the same @/ import graph as test files (includes turnBillableUsage side effects).
 */
import { writeFileSync } from "node:fs";
import { computeTurnBilling } from "@/lib/points";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "@/lib/chatModels";

void resolveTurnBillableUsage;

const NUMERIC_FIXTURES = [
  { id: "plain", raw: { prompt_tokens: 100, completion_tokens: 50 } },
  {
    id: "cache_explicit_zero",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
  },
  {
    id: "cache_positive",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 } },
  },
  {
    id: "cache_malformed",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "bad" } },
  },
  {
    id: "gemini_implicit_echo",
    raw: {
      prompt_tokens: 4541,
      completion_tokens: 1079,
      prompt_tokens_details: { cached_tokens: 4290, cache_write_tokens: 4290 },
    },
  },
  {
    id: "reasoning_positive",
    raw: { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 4912 } },
  },
  {
    id: "reasoning_explicit_zero",
    raw: { prompt_tokens: 1200, completion_tokens: 5976, completion_tokens_details: { reasoning_tokens: 0 } },
  },
  {
    id: "reasoning_malformed_float",
    raw: { prompt_tokens: 5000, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 5.5 } },
  },
  {
    id: "reasoning_malformed_string_float",
    raw: { prompt_tokens: 5000, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: "5.5" } },
  },
  {
    id: "mixed_cache_valid_invalid",
    raw: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: "bad", cache_read_tokens: 12 },
    },
  },
  {
    id: "mixed_cache_float_and_zero",
    raw: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 5.5, cache_read_tokens: 0 },
    },
  },
  {
    id: "header_body_mixed",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 5 } },
    headers: { "x-cache-read-tokens": "20" },
  },
  {
    id: "header_malformed_body_valid",
    raw: { prompt_tokens: 100, completion_tokens: 50 },
    headers: { "x-cache-read-tokens": "bad", "x-anthropic-cache-read-input-tokens": "20" },
  },
  {
    id: "empty_string_cache",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "" } },
  },
  {
    id: "whitespace_string_cache",
    raw: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: "   " } },
  },
];

const LIVE_BILLING_FIXTURES = [
  {
    id: "G37",
    input: {
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputTokens: 24_952,
      outputTokens: 2367,
    },
  },
  {
    id: "G31_OR",
    input: {
      provider: "openrouter",
      openRouterModelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      inputTokens: 40_689,
      outputTokens: 4307,
    },
  },
  {
    id: "G31_CI",
    input: {
      provider: "cheaperinference",
      openRouterModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      inputTokens: 40_689,
      outputTokens: 4307,
    },
  },
  {
    id: "Opus5",
    input: {
      provider: "openrouter",
      openRouterModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      inputTokens: 63_749,
      outputTokens: 3629,
      reasoningTokens: 800,
    },
  },
];

function numericSnapshot(raw, headersRecord) {
  const headers = headersRecord ? new Headers(headersRecord) : undefined;
  const b = parseOpenRouterUsage(raw, headers);
  return {
    promptTokens: b.promptTokens,
    completionTokens: b.completionTokens,
    reasoningTokens: b.reasoningTokens,
    cacheReadTokens: b.cacheReadTokens,
    cacheWriteTokens: b.cacheWriteTokens,
    standardInputTokens: b.standardInputTokens,
    estimated: b.estimated,
  };
}

const out = {
  capturedAtRef: process.env.BASELINE_GIT_REF ?? "unknown",
  numeric: Object.fromEntries(
    NUMERIC_FIXTURES.map((f) => [
      f.id,
      numericSnapshot(f.raw, f.headers),
    ])
  ),
  liveBilling: Object.fromEntries(
    LIVE_BILLING_FIXTURES.map((f) => {
      const r = computeTurnBilling({
        ...f.input,
        apiPromptTokens: f.input.inputTokens,
        apiCompletionTokens: f.input.outputTokens,
      });
      return [f.id, { total: r.total, baseCost: r.baseCost }];
    })
  ),
};

const dest = process.argv[2] ?? "src/lib/fixtures/openRouterUsageNumericBaseline.json";
writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${dest}`);
