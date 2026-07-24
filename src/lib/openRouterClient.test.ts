import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpenRouterRequestBody,
  isDeepSeekOpenRouterModel,
  isGlmOpenRouterModel,
  isKimiOpenRouterModel,
  isMuseOpenRouterModel,
  isOpenRouterRpReasoningDisabledModel,
  isOpenRouterRpReasoningMandatoryModel,
  isOpenRouterRpReasoningMuseModel,
  isQwenOpenRouterModel,
  GEMINI_PRO_GENERATION_PARAMS,
  OPENROUTER_RP_REASONING_GEMINI_FLASH,
  OPENROUTER_RP_REASONING_GEMINI_3_PRO,
  OPENROUTER_RP_REASONING_MUSE_SPARK,
  OPENROUTER_RP_REASONING_OFF,
  resolveOpenRouterMaxTokens,
  resolveRegenerateGenerationOverrides,
} from "@/lib/openRouterClient";
import { resolveMaxOutputTokensForTarget } from "@/lib/responseLength";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_GLM_52_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
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

  it("matches Kimi ids", () => {
    assert.equal(isKimiOpenRouterModel(OPENROUTER_KIMI_K3_MODEL), true);
    assert.equal(isKimiOpenRouterModel("moonshotai/kimi-latest"), true);
    assert.equal(isKimiOpenRouterModel(OPENROUTER_QWEN_37_MAX_MODEL), false);
  });

  it("matches Muse Spark ids", () => {
    assert.equal(isMuseOpenRouterModel(OPENROUTER_MUSE_SPARK_11_MODEL), true);
    assert.equal(isMuseOpenRouterModel("meta/muse-spark-1.1"), true);
    assert.equal(isMuseOpenRouterModel(OPENROUTER_QWEN_37_MAX_MODEL), false);
  });

  it("disable union covers DeepSeek, Qwen, GLM, and Kimi — not Muse", () => {
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_QWEN_37_MAX_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GLM_52_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_KIMI_K3_MODEL), true);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_MUSE_SPARK_11_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_31_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningDisabledModel("anthropic/claude-3-opus"), false);
  });

  it("Muse uses mandatory minimal effort policy (not disable)", () => {
    assert.equal(isOpenRouterRpReasoningMuseModel(OPENROUTER_MUSE_SPARK_11_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMuseModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
  });

  it("mandatory reasoning policy covers Gemini 2.5 and 3.1 Pro", () => {
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_25_PRO_MODEL), false);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_GEMINI_31_PRO_MODEL), true);
    assert.equal(isOpenRouterRpReasoningMandatoryModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL), false);
  });
});

describe("resolveRpOpenRouterModelId — keeps Pro slug", () => {
  it("keeps 2.5 Pro slug", () => {
    assert.equal(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      OPENROUTER_GEMINI_36_FLASH_MODEL
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
      OPENROUTER_GEMINI_36_FLASH_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_GEMINI_FLASH);
    assert.equal(OPENROUTER_RP_REASONING_GEMINI_FLASH.effort, "minimal");
    assert.equal(body.include_reasoning, false);
    assert.equal(body.temperature, undefined);
    assert.equal(body.top_p, undefined);
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

  it("disables reasoning for Kimi RP requests", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_KIMI_K3_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.equal(body.include_reasoning, false);
    assert.equal(body.max_tokens, undefined);
  });

  it("uses mandatory minimal reasoning for Muse Spark RP requests", () => {
    const body = buildOpenRouterRequestBody(
      OPENROUTER_MUSE_SPARK_11_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_MUSE_SPARK);
    assert.equal(OPENROUTER_RP_REASONING_MUSE_SPARK.effort, "minimal");
    assert.equal(body.include_reasoning, false);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.max_tokens, undefined);
    // Must not disable reasoning (provider rejects none / enabled:false).
    assert.notDeepEqual(body.reasoning, OPENROUTER_RP_REASONING_OFF);
  });

  it("keeps DeepSeek/Qwen/Kimi reasoning-off unchanged when Muse policy is present", () => {
    const deepseek = buildOpenRouterRequestBody(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    const qwen = buildOpenRouterRequestBody(
      OPENROUTER_QWEN_37_MAX_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    const kimi = buildOpenRouterRequestBody(
      OPENROUTER_KIMI_K3_MODEL,
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(deepseek.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.deepEqual(qwen.reasoning, OPENROUTER_RP_REASONING_OFF);
    assert.deepEqual(kimi.reasoning, OPENROUTER_RP_REASONING_OFF);
  });

  it("does not preserve a Gemini 2.5 dedicated reasoning path", () => {
    const body = buildOpenRouterRequestBody(
      resolveRpOpenRouterModelId(OPENROUTER_GEMINI_25_PRO_MODEL),
      [{ role: "user", content: "test" }],
      true,
      3500,
      "chat-1"
    ) as Record<string, unknown>;
    assert.deepEqual(body.reasoning, OPENROUTER_RP_REASONING_GEMINI_FLASH);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.include_reasoning, false);
    assert.equal(body.provider, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.temperature, undefined);
    assert.equal(body.model, OPENROUTER_GEMINI_36_FLASH_MODEL);
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
  it("keeps Gemini 3.6 sampling parameters omitted on regenerate", () => {
    const overrides = resolveRegenerateGenerationOverrides(
      OPENROUTER_GEMINI_36_FLASH_MODEL,
      3500
    );
    assert.equal(overrides.temperature, undefined);
    assert.equal(overrides.top_p, undefined);
    assert.ok(overrides.seed != null);
  });

  it("keeps Qwen regen temperature below 1.0 to reduce mid-stream script salad", () => {
    const overrides = resolveRegenerateGenerationOverrides(OPENROUTER_QWEN_37_MAX_MODEL, 3500);
    assert.ok(overrides.temperature != null);
    assert.ok(overrides.temperature >= 0.75 && overrides.temperature <= 0.95);
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
    assert.ok((body.temperature as number) <= 0.95);
  });

  it("uses a modest DeepSeek regen temperature bump (not 1.2)", () => {
    const overrides = resolveRegenerateGenerationOverrides(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 3200);
    assert.ok(overrides.temperature != null);
    assert.ok(overrides.temperature >= 0.95 && overrides.temperature <= 1.05);
    assert.equal(overrides.temperature, 1.02);
  });
});
