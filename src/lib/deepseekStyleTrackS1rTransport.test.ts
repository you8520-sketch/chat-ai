import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  applyDeepSeek0813TrueOffExperimentOverlay,
  isDeepSeek0813TrueOffOutbound,
} from "./deepseekStyleTrackS1rTransport";

describe("Style Track S1R true-off overlay", () => {
  it("does not change the production DeepSeek adapter", () => {
    const production = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
      reasoning: { effort: "none" },
      include_reasoning: true,
    });
    assert.deepEqual(production.thinking, { type: "disabled" });
    assert.equal(production.reasoning_effort, undefined);
    assert.equal(production.reasoning, undefined);
    assert.equal(production.include_reasoning, undefined);
    assert.equal(production.enable_thinking, undefined);
    assert.equal(isDeepSeek0813TrueOffOutbound(production), false);
  });

  it("adds reasoning_effort=none after the production adapter without extra fields", () => {
    const production = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    const overlay = applyDeepSeek0813TrueOffExperimentOverlay(production);
    assert.equal(isDeepSeek0813TrueOffOutbound(overlay), true);
    assert.deepEqual(overlay.thinking, { type: "disabled" });
    assert.equal(overlay.reasoning_effort, "none");
    assert.equal(overlay.reasoning, undefined);
    assert.equal(overlay.include_reasoning, undefined);
    assert.equal(overlay.enable_thinking, undefined);
    assert.equal(production.reasoning_effort, undefined);
  });
});
