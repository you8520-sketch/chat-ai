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

const enabled: AdultSceneModelPolicyConfig = {
  aionPrimaryEnabled: true,
  glmHardFailureFallbackEnabled: true,
  adminOnly: true,
};

test("final rollout defaults to public Aion primary with GLM hard-failure fallback", () => {
  const config = resolveAdultSceneModelPolicyConfig({});
  assert.equal(config.aionPrimaryEnabled, true);
  assert.equal(config.glmHardFailureFallbackEnabled, true);
  assert.equal(config.adminOnly, false);
});

test("policy is disabled for non-admin users", () => {
  assert.equal(isAdultSceneModelPolicyActive({ config: enabled, isAdmin: false }), false);
  assert.equal(isAdultSceneModelPolicyActive({ config: enabled, isAdmin: true }), true);
});

test("short usable output is neither continued nor classified as a GLM fallback reason", () => {
  const reason = classifyAdultSceneHardFailure({
    text: "짧지만 정상적으로 전달 가능한 출력",
    finishReason: "length",
  });
  assert.equal(reason, null);
  assert.equal(shouldFallbackToGlm({
    config: enabled,
    isAdmin: true,
    reason,
    fallbackAttemptCount: 0,
  }), false);
  assert.equal(ADULT_SCENE_MODEL_POLICY.hardFailureFallbackModelId, "glm-5.2");
});

test("only transport or explicit refusal failures qualify for GLM fallback", () => {
  const cases = [
    { input: { status: 503 }, expected: "provider_5xx" },
    { input: { error: new Error("request timeout") }, expected: "timeout" },
    { input: { error: new Error("invalid json in stream") }, expected: "stream_parse_failure" },
    { input: { error: new Error("socket closed") }, expected: "http_error" },
    { input: { text: "", finishReason: "empty_stream" }, expected: "empty_stream" },
    { input: { text: "", finishReason: "stop" }, expected: "no_visible_content" },
    { input: { text: "refusal", refusalDetected: true }, expected: "model_refusal" },
  ] as const;

  for (const fixture of cases) {
    const reason = classifyAdultSceneHardFailure(fixture.input);
    assert.equal(reason, fixture.expected);
    assert.equal(shouldFallbackToGlm({
      config: enabled,
      isAdmin: true,
      reason,
      fallbackAttemptCount: 0,
    }), true);
  }
});

test("GLM fallback is limited to one classified hard failure", () => {
  assert.equal(shouldFallbackToGlm({
    config: enabled,
    isAdmin: true,
    reason: "provider_5xx",
    fallbackAttemptCount: 0,
  }), true);
  assert.equal(shouldFallbackToGlm({
    config: enabled,
    isAdmin: true,
    reason: null,
    fallbackAttemptCount: 0,
  }), false);
  assert.equal(shouldFallbackToGlm({
    config: enabled,
    isAdmin: true,
    reason: "provider_5xx",
    fallbackAttemptCount: 1,
  }), false);
});
