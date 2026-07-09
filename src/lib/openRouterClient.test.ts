import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpenRouterRequestBody,
  isDeepSeekOpenRouterModel,
  isGlmOpenRouterModel,
  isOpenRouterRpReasoningDisabledModel,
  isOpenRouterRpReasoningMandatoryModel,
  isQwenOpenRouterModel,
  GEMINI_PRO_GENERATION_PARAMS,
  OPENROUTER_RP_REASONING_GEMINI_FLASH,
  OPENROUTER_RP_REASONING_GEMINI_25_PRO_CAP,
  OPENROUTER_RP_REASONING_GEMINI_3_PRO,
  OPENROUTER_RP_REASONING_OFF,
  resolveOpenRouterMaxTokens,
  resolveRegenerateGenerationOverrides,
} from "@/lib/openRouterClient";
import { resolveMaxOutputTokensForTarget } from "@/lib/responseLength";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GLM_52_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { resolveRpOpenRouterModelId } from "@/lib/openRouterConfig";

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

  it("matches GLM ids", () => {
    assert.equal(isGlmOpenRouterModel(OPENROUTER_GLM_52_MODEL), true);
    assert.equal(isGlmOpenRouterModel("z-ai/glm-5.1"), true);
    assert.equal(isGlmOpenRouterModel(OPENROUTER_QWEN_37_MAX_MODEL), false);
  });

  it("disable union covers DeepSeek, Qwen, and GLM", () => {
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_QWEN_37_MAX_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GLM_52_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel("anthropic/claude-3-opus"), false);
  });

  it("mandatory reasoning policy covers Gemini 2.5 and 3.1 Pro", () => {
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_25_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_31_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
  });
});

describe("resolveRpOpenRouterModelId — keeps Pro slug", () => {
  it("keeps 2.5 Pro slug", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_25_PRO_MODEL
    );
  });

  it("keeps 3.1 Pro slug", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_31_PRO_MODEL),
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
  });

  it("keeps DeepSeek slug unchanged", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_DEEPSEEK_V4_PRO_MODEL),
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    );
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
    assert.equal(body.include_reasoning, false);
    assert.equal(body.max_tokens, undefined);
  });

  it("uses minimal reasoning for Gemini Flash", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_25_FLASH_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_GEMINI_FLASH);
    assert.equal(body.include_reasoning, false);
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
    assert.equal(body.include_reasoning, false);
    assert.equal(body.max_tokens, undefined);
  });

  it("disables reasoning for GLM RP requests", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GLM_52_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.equal(body.include_reasoning, false);
    assert.equal(body.max_tokens, undefined);
  });

  it("caps Gemini 2.5 Pro reasoning at 128 tokens (cost-oriented thinking budget)", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_25_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_GEMINI_25_PRO_CAP);
    assert.equal(OPENROUTER_RP_REASONING_GEMINI_25_PRO_CAP.max_tokens, 128);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, false);
    assert.equal(body.provider, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.equal(resolveMaxOutputTokensForTarget(3500, OPENROUTER_GEMINI_25_PRO_MODEL), undefined);
    assert.equal(body.temperature, GEMINI_PRO_GENERATION_PARAMS.temperature);
    assert.equal(body.model, OPENROUTER_GEMINI_25_PRO_MODEL);
  });

  it("uses effort low for Gemini 3.1 Pro reasoning (thinkingLevel path)", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_31_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_GEMINI_3_PRO);
    assert.equal(body.include_reasoning, false);
    assert.equal(body.provider, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.equal(resolveMaxOutputTokensForTarget(3500, OPENROUTER_GEMINI_31_PRO_MODEL), undefined);
    assert.equal(body.temperature, GEMINI_PRO_GENERATION_PARAMS.temperature);
    assert.equal(body.model, OPENROUTER_GEMINI_31_PRO_MODEL);
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
    assert.equal(body.provider, undefined);
    assert.equal(body.max_tokens, undefined);
  });

  it("honors maxTokensOverride when set", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_QWEN_37_MAX_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1",
      512
    ) as Record<string, unknown>;
    assert.equal(body.max_tokens, 512);
    assert.equal(resolveOpenRouterMaxTokens(3500, 512, OPENROUTER_QWEN_37_MAX_MODEL), 512);
  });
});

describe("resolveRegenerateGenerationOverrides", () => {
  it("raises temperature floor and sets random seed", () => {
    const overrides = resolveRegenerateGenerationOverrides(OPENROUTER_QWEN_37_MAX_MODEL, 3500);
    assert.ok(overrides.temperature != null && overrides.temperature >= 1.0);
    assert.ok(overrides.seed != null && overrides.seed >= 0);
    const body = buildOpenRouterRequestBody(
      OPENROUTER_QWEN_37_MAX_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1-regen",
      undefined,
      overrides
    ) as Record<string, unknown>;
    assert.equal(body.seed, overrides.seed);
    assert.ok((body.temperature as number) >= 1.0);
  });
});
