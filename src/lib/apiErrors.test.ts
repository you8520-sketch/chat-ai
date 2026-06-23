import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHttpApiError,
  formatOpenRouterInsufficientCreditsError,
  parseOpenRouterAffordableMaxTokens,
} from "@/lib/apiErrors";

describe("OpenRouter 402 credits", () => {
  it("parses affordable max_tokens from OpenRouter error body", () => {
    const body =
      "402 Payment Required: This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 1276.";
    assert.equal(parseOpenRouterAffordableMaxTokens(body), 1276);
  });

  it("formatHttpApiError returns Korean message for 402", () => {
    const msg = formatHttpApiError(402, "Payment Required", "can only afford 1276");
    assert.match(msg, /OpenRouter API 크레딧/);
    assert.match(msg, /1,276/);
  });

  it("formatOpenRouterInsufficientCreditsError without parseable amount", () => {
    assert.match(formatOpenRouterInsufficientCreditsError(null), /openrouter\.ai\/settings\/credits/);
  });
});
