import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOpenAiTerraModel,
  isOpenRouterSelectedAI,
  isValidSelectedAI,
  OPENAI_GPT_56_TERRA_MODEL,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";

describe("GPT-5.6 Terra model selection", () => {
  it("is selectable through the direct OpenAI provider, not OpenRouter", () => {
    assert.equal(OPENAI_GPT_56_TERRA_MODEL, "gpt-5.6-terra");
    assert.equal(isValidSelectedAI(OPENAI_GPT_56_TERRA_MODEL), true);
    assert.equal(isOpenAiTerraModel(OPENAI_GPT_56_TERRA_MODEL), true);
    assert.equal(selectedAIProvider(OPENAI_GPT_56_TERRA_MODEL), "openai");
    assert.equal(isOpenRouterSelectedAI(OPENAI_GPT_56_TERRA_MODEL), false);
    assert.equal(selectedAILabel(OPENAI_GPT_56_TERRA_MODEL), "GPT-5.6 Terra");
  });
});
