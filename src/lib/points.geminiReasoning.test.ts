import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";
import { billableOpenRouterOutputTokens } from "@/lib/points";

describe("billableOpenRouterOutputTokens — Gemini 2.5 Pro", () => {
  it("excludes reasoning tokens from billable output", () => {
    assert.equal(
      billableOpenRouterOutputTokens(OPENROUTER_GEMINI_25_PRO_MODEL, 2293, 1618),
      675
    );
  });

  it("does not subtract for other models", () => {
    assert.equal(
      billableOpenRouterOutputTokens("qwen/qwen3.7-max", 2293, 1618),
      2293
    );
  });
});
