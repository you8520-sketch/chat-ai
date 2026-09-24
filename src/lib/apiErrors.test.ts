import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCheaperInferenceInsufficientBalanceError,
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

  it("formats CheaperInference 402 without mislabeling it as OpenRouter", () => {
    const body = JSON.stringify({
      error: {
        message: "Insufficient wallet balance for this request.",
        type: "invalid_request_error",
        code: "insufficient_balance",
      },
    });
    const msg = formatHttpApiError(
      402,
      "Payment Required",
      body,
      "CheaperInference"
    );
    assert.match(msg, /CheaperInference API/);
    assert.match(msg, /insufficient_balance/);
    assert.doesNotMatch(msg, /OpenRouter/);
    assert.equal(msg, formatCheaperInferenceInsufficientBalanceError());
  });
});
