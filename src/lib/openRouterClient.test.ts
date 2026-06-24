import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpenRouterRequestBody,
  isDeepSeekOpenRouterModel,
  isOpenRouterRpReasoningDisabledModel,
  isOpenRouterRpReasoningMandatoryModel,
  isQwenOpenRouterModel,
  OPENROUTER_RP_REASONING_GEMINI_31,
  OPENROUTER_RP_REASONING_GEMINI_CAP,
  OPENROUTER_RP_REASONING_GEMINI_FLASH,
  OPENROUTER_RP_REASONING_OFF,
} from "@/lib/openRouterClient";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
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

describe("resolveRpOpenRouterModelId — Gemini Pro → Flash", () => {
  it("routes 2.5 Pro to google/gemini-2.5-flash", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_25_FLASH_MODEL
    );
  });

  it("routes 3.1 Pro to google/gemini-3.1-flash-lite", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_31_PRO_MODEL),
      OPENROUTER_GEMINI_31_FLASH_MODEL
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
  });

  it("uses minimal reasoning for Gemini Flash RP routing", () => {
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
  });

  it("caps mandatory reasoning for Gemini 2.5 Pro when routed off", () => {
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
    assert.equal(body.include_reasoning, false);
  });

  it("uses low thinkingLevel for Gemini 3.1 Pro when routed off", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_GEMINI_31_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    const reasoning = body.reasoning as Record<string, unknown>;
    assert.equal(reasoning.effort, OPENROUTER_RP_REASONING_GEMINI_31.effort);
    assert.equal(reasoning.max_tokens, undefined);
    assert.equal(reasoning.exclude, true);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, false);
  });

  it("maps env minimal to low for Gemini 3.1 Pro", () => {
    const prev = process.env.OPENROUTER_GEMINI_31_REASONING_EFFORT;
    process.env.OPENROUTER_GEMINI_31_REASONING_EFFORT = "minimal";
    try {
      const body = buildOpenRouterRequestBody(
        OPENROUTER_GEMINI_31_PRO_MODEL,
        [{ role: "user", content: "test" }],
        true,
        3500,
        "chat-1"
      ) as Record<string, unknown>;
      const reasoning = body.reasoning as Record<string, unknown>;
      assert.equal(reasoning.effort, "low");
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_GEMINI_31_REASONING_EFFORT;
      else process.env.OPENROUTER_GEMINI_31_REASONING_EFFORT = prev;
    }
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
