import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENROUTER_GEMINI_36_FLASH_MODEL } from "@/lib/chatModels";
import { billableOpenRouterOutputTokens } from "@/lib/points";

describe("billableOpenRouterOutputTokens — Gemini 3.6 Flash", () => {
  it("excludes reasoning tokens from billable output", () => {
    assert.equal(
      billableOpenRouterOutputTokens(OPENROUTER_GEMINI_36_FLASH_MODEL, 2293, 1618),
      675
    );
  });

  it("does not subtract for other models", () => {
    assert.equal(
      billableOpenRouterOutputTokens("qwen/qwen3.7-max", 2293, 1618),
      2293
    );
  });

  it("also excludes hidden Muse reasoning from user billing", () => {
    assert.equal(
      billableOpenRouterOutputTokens("meta/muse-spark-1.1", 2293, 1618),
      675
    );
  });
});
