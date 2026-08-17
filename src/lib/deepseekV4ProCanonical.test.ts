import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  DEFAULT_SELECTED_AI,
  isCheaperInferenceModel,
  isDeepSeekV4ProModel,
  normalizeDeepSeekV4ProModelId,
  resolveSelectedAI,
} from "./chatModels";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import { resolveAdultRoutingConfig } from "./adultSceneRouting";
import { ADULT_SCENE_MODEL_POLICY } from "./adultSceneModelPolicy";

describe("DeepSeek V4 Pro 0813 canonicalization", () => {
  it("uses 0813 as the default selected DeepSeek model", () => {
    assert.equal(DEFAULT_SELECTED_AI, "deepseek-v4-pro-0813");
    assert.equal(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL,
      "deepseek-v4-pro"
    );
  });

  it("normalizes stored and env aliases to 0813 before provider requests", () => {
    assert.equal(
      normalizeDeepSeekV4ProModelId("deepseek-v4-pro"),
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      normalizeDeepSeekV4ProModelId("deepseek-v4-pro-0813"),
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      resolveSelectedAI("deepseek-v4-pro"),
      "deepseek-v4-pro-0813"
    );
  });

  it("canonicalizes ADULT_MODEL_ID aliases to 0813", () => {
    assert.equal(
      resolveAdultRoutingConfig({}).adultModelId,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      resolveAdultRoutingConfig({ ADULT_MODEL_ID: "deepseek-v4-pro" }).adultModelId,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      resolveAdultRoutingConfig({
        ADULT_MODEL_ID: "deepseek-v4-pro-0813",
      }).adultModelId,
      "deepseek-v4-pro-0813"
    );
  });

  it("recognizes 0813 as DeepSeek V4 Pro and CheaperInference", () => {
    assert.equal(isDeepSeekV4ProModel("deepseek-v4-pro-0813"), true);
    assert.equal(isCheaperInferenceModel("deepseek-v4-pro-0813"), true);
    assert.equal(isDeepSeekV4ProModel("deepseek-v4-pro"), true);
  });

  it("sends 0813 with thinking disabled and without the legacy alias", () => {
    const adapted = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    assert.equal(adapted.model, "deepseek-v4-pro-0813");
    assert.deepEqual(adapted.thinking, { type: "disabled" });
    assert.equal(adapted.reasoning_effort, "none");
    assert.equal(adapted.reasoning, undefined);
    assert.equal(adapted.include_reasoning, undefined);
    assert.equal(adapted.model === "deepseek-v4-pro", false);
  });

  it("rewrites a legacy stored model to 0813 on the wire", () => {
    const adapted = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(adapted.model, "deepseek-v4-pro-0813");
    assert.deepEqual(adapted.thinking, { type: "disabled" });
    assert.equal(adapted.reasoning_effort, "none");
  });
});

describe("Aion adult runtime absence", () => {
  it("keeps only DeepSeek 0813 primary and GLM max-1 fallback", () => {
    assert.equal(
      ADULT_SCENE_MODEL_POLICY.primaryModelId,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      ADULT_SCENE_MODEL_POLICY.hardFailureFallbackModelId,
      "glm-5.2"
    );
    assert.equal(ADULT_SCENE_MODEL_POLICY.maximumFallbackAttempts, 1);
    const policy = ADULT_SCENE_MODEL_POLICY as Record<string, unknown>;
    assert.equal(policy.aionPrimaryEnabled, undefined);
    assert.equal(/aion/i.test(JSON.stringify(ADULT_SCENE_MODEL_POLICY)), false);
  });
});
