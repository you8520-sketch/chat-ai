import assert from "node:assert/strict";
import test from "node:test";
import {
  ADULT_SCENE_MODEL_POLICY,
  classifyAdultSceneHardFailure,
  resolveAdultSceneModelPolicyConfig,
  shouldFallbackToGlm,
  type AdultSceneModelPolicyConfig,
} from "./adultSceneModelPolicy.ts";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels.ts";

const glmEnabled: AdultSceneModelPolicyConfig = {
  glmHardFailureFallbackEnabled: true,
  adminOnly: false,
};

test("defaults keep DeepSeek 0813 adult primary and no Aion policy", () => {
  const config = resolveAdultSceneModelPolicyConfig({});
  assert.equal(config.glmHardFailureFallbackEnabled, true);
  assert.equal(config.adminOnly, false);
  assert.equal(
    ADULT_SCENE_MODEL_POLICY.primaryModelId,
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
  assert.equal(ADULT_SCENE_MODEL_POLICY.primaryModelId, "deepseek-v4-pro-0813");
  assert.equal(ADULT_SCENE_MODEL_POLICY.hardFailureFallbackModelId, "glm-5.2");
  assert.equal(ADULT_SCENE_MODEL_POLICY.maximumFallbackAttempts, 1);
  assert.equal(
    "aionPrimaryEnabled" in (config as Record<string, unknown>),
    false
  );
});

test("Aion primary and Aion fallback are impossible", () => {
  const policy = ADULT_SCENE_MODEL_POLICY as Record<string, unknown>;
  assert.notEqual(String(policy.primaryModelId), "aion-2.0");
  assert.notEqual(String(policy.hardFailureFallbackModelId), "aion-2.0");
  assert.equal(policy.aionPrimaryEnabled, undefined);
  assert.equal(
    shouldFallbackToGlm({
      config: glmEnabled,
      isAdmin: true,
      reason: "provider_5xx",
      fallbackAttemptCount: 0,
    }),
    true
  );
});

test("short usable DeepSeek output is not a GLM fallback reason", () => {
  const reason = classifyAdultSceneHardFailure({
    text: "짧지만 정상적으로 전달 가능한 출력",
    finishReason: "length",
  });
  assert.equal(reason, null);
  assert.equal(
    shouldFallbackToGlm({
      config: glmEnabled,
      isAdmin: true,
      reason,
      fallbackAttemptCount: 0,
    }),
    false
  );
});

test("only transport or explicit refusal failures qualify for GLM fallback", () => {
  const cases = [
    { input: { status: 503 }, expected: "provider_5xx" },
    { input: { error: new Error("request timeout") }, expected: "timeout" },
    {
      input: { error: new Error("invalid json in stream") },
      expected: "stream_parse_failure",
    },
    { input: { error: new Error("socket closed") }, expected: "http_error" },
    {
      input: { text: "", finishReason: "empty_stream" },
      expected: "empty_stream",
    },
    { input: { text: "", finishReason: "stop" }, expected: "no_visible_content" },
    {
      input: { text: "refusal", refusalDetected: true },
      expected: "model_refusal",
    },
  ] as const;

  for (const fixture of cases) {
    const reason = classifyAdultSceneHardFailure(fixture.input);
    assert.equal(reason, fixture.expected);
    assert.equal(
      shouldFallbackToGlm({
        config: glmEnabled,
        isAdmin: true,
        reason,
        fallbackAttemptCount: 0,
      }),
      true
    );
  }
});

test("GLM fallback is limited to one classified hard failure", () => {
  assert.equal(
    shouldFallbackToGlm({
      config: glmEnabled,
      isAdmin: true,
      reason: "provider_5xx",
      fallbackAttemptCount: 0,
    }),
    true
  );
  assert.equal(
    shouldFallbackToGlm({
      config: glmEnabled,
      isAdmin: true,
      reason: null,
      fallbackAttemptCount: 0,
    }),
    false
  );
  assert.equal(
    shouldFallbackToGlm({
      config: glmEnabled,
      isAdmin: true,
      reason: "provider_5xx",
      fallbackAttemptCount: 1,
    }),
    false
  );
});
