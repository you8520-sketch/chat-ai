import assert from "node:assert/strict";
import test from "node:test";
import {
  ADULT_SCENE_MODEL_POLICY,
  classifyAdultSceneHardFailure,
  isAdultSceneModelPolicyActive,
  resolveAdultSceneModelPolicyConfig,
  shouldFallbackToGlm,
  type AdultSceneModelPolicyConfig,
} from "./adultSceneModelPolicy.ts";

const glmEnabled: AdultSceneModelPolicyConfig = {
  aionPrimaryEnabled: false,
  glmHardFailureFallbackEnabled: true,
  adminOnly: false,
};

const legacyAionAdminOnly: AdultSceneModelPolicyConfig = {
  aionPrimaryEnabled: true,
  glmHardFailureFallbackEnabled: true,
  adminOnly: true,
};

test("defaults keep DeepSeek adult primary and Aion primary OFF", () => {
  const config = resolveAdultSceneModelPolicyConfig({});
  assert.equal(config.aionPrimaryEnabled, false);
  assert.equal(config.glmHardFailureFallbackEnabled, true);
  assert.equal(config.adminOnly, false);
  assert.equal(ADULT_SCENE_MODEL_POLICY.primaryModelId, "deepseek-v4-pro-0813");
  assert.equal(ADULT_SCENE_MODEL_POLICY.hardFailureFallbackModelId, "glm-5.2");
});

test("legacy Aion primary remains admin-gated when explicitly enabled", () => {
  assert.equal(
    isAdultSceneModelPolicyActive({
      config: legacyAionAdminOnly,
      isAdmin: false,
    }),
    false
  );
  assert.equal(
    isAdultSceneModelPolicyActive({
      config: legacyAionAdminOnly,
      isAdmin: true,
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
