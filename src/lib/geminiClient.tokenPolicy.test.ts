import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGeminiGenerationConfig,
  buildGeminiThinkingConfig,
} from "./geminiClient";

describe("Gemini RP and memory token policy", () => {
  it("omits output caps even when callers provide an override", () => {
    const config = buildGeminiGenerationConfig(
      "gemini-3.1-pro-preview",
      3500,
      "primary-stream",
      128
    );

    assert.equal(config.maxOutputTokens, undefined);
    assert.deepEqual(config.thinkingConfig, { thinkingLevel: "low" });
  });

  it("uses the lowest supported thinking setting for each Gemini family", () => {
    assert.deepEqual(buildGeminiThinkingConfig("gemini-2.5-flash"), {
      thinkingBudget: 0,
    });
    assert.deepEqual(buildGeminiThinkingConfig("gemini-3.6-flash"), {
      thinkingLevel: "minimal",
    });
    assert.deepEqual(buildGeminiThinkingConfig("gemini-3.1-pro-preview"), {
      thinkingLevel: "low",
    });
  });

  it("keeps background memory unbounded and disables legacy Gemini thinking", () => {
    const config = buildGeminiGenerationConfig(
      "gemini-2.5-flash",
      null,
      "background-memory-extract",
      400
    );

    assert.equal(config.maxOutputTokens, undefined);
    assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
  });
});
