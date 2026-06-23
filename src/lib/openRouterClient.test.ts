import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpenRouterRequestBody,
  isDeepSeekOpenRouterModel,
  isOpenRouterRpReasoningDisabledModel,
  isOpenRouterRpReasoningMandatoryModel,
  isQwenOpenRouterModel,
  OPENROUTER_RP_REASONING_GEMINI_CAP,
  OPENROUTER_RP_REASONING_OFF,
} from "@/lib/openRouterClient";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";

describe("OpenRouter reasoning-disable model detection", () => {
  it("matches DeepSeek ids", () => {
    assert.equal(isDeepSeekOpenRouterModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isDeepSeekOpenRouterModel("deepseek/deepseek-v4-flash"), true);
    assert.equal(isDeepSeekOpenRouterModel("anthropic/claude-3-opus"), false);
  });

  it("matches Qwen ids", () => {
    assert.equal(isQwenOpenRouterModel(OPENROUTER_QWEN_37_MAX_MODEL), true);
    assert.equal(isQwenOpenRouterModel("qwen/qwen3-max"), true);
    assert.equal(isQwenOpenRouterModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
  });

  it("disable union covers DeepSeek and Qwen only", () => {
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_QWEN_37_MAX_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel("anthropic/claude-3-opus"), false);
  });

  it("mandatory reasoning covers Gemini 2.5 and 3.1 Pro", () => {
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_25_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_31_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
  });
});

describe("buildOpenRouterRequestBody — RP reasoning policy", () => {
  it("disables reasoning for DeepSeek RP requests", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, undefined);
  });

  it("disables reasoning for Qwen RP requests", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_QWEN_37_MAX_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, undefined);
  });

  it("caps mandatory reasoning for Gemini 2.5 Pro (not effort none)", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_25_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    const reasoning = body.reasoning as Record<string, unknown>;
    assert.equal(reasoning.effort, undefined);
    assert.equal(reasoning.max_tokens, OPENROUTER_RP_REASONING_GEMINI_CAP.max_tokens);
    assert.equal(reasoning.exclude, true);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, undefined);
  });

  it("caps mandatory reasoning for Gemini 3.1 Pro (not effort none)", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_31_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    const reasoning = body.reasoning as Record<string, unknown>;
    assert.equal(reasoning.effort, undefined);
    assert.equal(reasoning.max_tokens, OPENROUTER_RP_REASONING_GEMINI_CAP.max_tokens);
    assert.equal(reasoning.exclude, true);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, undefined);
  });

  it("does not set reasoning for non-reasoning RP models", () => {
    const body = buildOpenRouterRequestBody(
      "anthropic/claude-3-opus",
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.equal(body.reasoning, undefined);
  });
});
