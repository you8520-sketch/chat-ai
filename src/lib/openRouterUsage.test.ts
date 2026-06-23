import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseOpenRouterUsage,
  parseReasoningTokens,
  tokenUsageFromOpenRouterBreakdown,
} from "@/lib/openRouterUsage";

describe("parseReasoningTokens", () => {
  it("reads completion_tokens_details.reasoning_tokens", () => {
    assert.equal(
      parseReasoningTokens({
        completion_tokens: 5976,
        completion_tokens_details: { reasoning_tokens: 4912 },
      }),
      4912
    );
  });

  it("returns 0 when absent", () => {
    assert.equal(parseReasoningTokens({ completion_tokens: 100 }), 0);
    assert.equal(parseReasoningTokens(null), 0);
  });
});

describe("parseOpenRouterUsage", () => {
  it("includes reasoningTokens in breakdown", () => {
    const b = parseOpenRouterUsage({
      prompt_tokens: 1200,
      completion_tokens: 5976,
      completion_tokens_details: { reasoning_tokens: 4912 },
    });
    assert.equal(b.completionTokens, 5976);
    assert.equal(b.reasoningTokens, 4912);
    assert.equal(b.estimated, false);
  });

  it("reads Gemini implicit cache from prompt_tokens_details.cached_tokens", () => {
    const b = parseOpenRouterUsage({
      prompt_tokens: 4541,
      completion_tokens: 1079,
      prompt_tokens_details: {
        cached_tokens: 4290,
        cache_write_tokens: 4290,
      },
      cost_details: {
        upstream_inference_cost: 0.01324875,
        upstream_inference_prompt_cost: 0.00245875,
        upstream_inference_completions_cost: 0.01079,
      },
    });
    assert.equal(b.cacheReadTokens, 4290);
    assert.equal(b.cacheWriteTokens, 0);
    assert.equal(b.standardInputTokens, 251);
    assert.equal(b.upstreamPromptCostUsd, 0.00245875);
    assert.equal(b.promptTokensDetailsRaw?.cached_tokens, 4290);
  });

  it("reads DeepSeek prefix cache hit on turn 2", () => {
    const b = parseOpenRouterUsage({
      prompt_tokens: 4894,
      completion_tokens: 318,
      prompt_tokens_details: {
        cached_tokens: 3072,
        cache_write_tokens: 0,
      },
    });
    assert.equal(b.cacheReadTokens, 3072);
    assert.equal(b.cacheWriteTokens, 0);
    assert.equal(b.standardInputTokens, 1822);
  });

  it("parses signed cache_discount", () => {
    const b = parseOpenRouterUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      cache_discount: -0.0025,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 800 },
    });
    assert.equal(b.cacheDiscountUsd, -0.0025);
  });
});

describe("tokenUsageFromOpenRouterBreakdown", () => {
  it("maps reasoningTokens to reasoningOutputTokens when > 0", () => {
    const usage = tokenUsageFromOpenRouterBreakdown({
      promptTokens: 1200,
      completionTokens: 5976,
      reasoningTokens: 4912,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      standardInputTokens: 1200,
      estimated: false,
    });
    assert.equal(usage.outputTokens, 5976);
    assert.equal(usage.reasoningOutputTokens, 4912);
  });

  it("omits reasoningOutputTokens when zero", () => {
    const usage = tokenUsageFromOpenRouterBreakdown({
      promptTokens: 100,
      completionTokens: 50,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      standardInputTokens: 100,
      estimated: false,
    });
    assert.equal(usage.reasoningOutputTokens, undefined);
  });
});
