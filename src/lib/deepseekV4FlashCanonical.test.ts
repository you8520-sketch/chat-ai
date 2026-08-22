import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceDeepSeekV4FlashModel,
  isCheaperInferenceModel,
  isValidSelectedAI,
  normalizeDeepSeekV4FlashModelId,
  resolveSelectedAI,
  selectedAILabel,
} from "./chatModels";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  BACKGROUND_OPENROUTER_MODEL,
  callBackgroundMemory,
  resolveBackgroundTextModelId,
} from "./ai";
import { resolveAdultRoutingConfig } from "./adultSceneRouting";
import { ADULT_SCENE_MODEL_POLICY } from "./adultSceneModelPolicy";
import { callOpenRouterCompletion } from "./openRouterCompletion";
import { resolveOpenRouterModelRates } from "./openRouterModelPricing";
import { resolveOpenRouterReasoningPointRates } from "./points";
import { estimateApiCostUsd } from "./adminFinance";
import {
  DEFAULT_TRANSLATION_PRIMARY_MODEL,
  resolveTranslationModels,
} from "./promptTranslation";
import { ensureUserSelectedAI } from "./userSelectedAI";
import { statusWidgetExtractModelLabel } from "./statusWidget/receiptUsage";
import { computeHtmlFlashOnlyTurnBilling } from "./points";

async function captureOutboundModel(opts: {
  model: string;
  requestKind?: string;
}): Promise<string | undefined> {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  let requestedModel: string | undefined;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    requestedModel = body.model;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    await callOpenRouterCompletion({
      model: opts.model,
      system: "system",
      history: [{ role: "user", content: "hello" }],
      requestKind: opts.requestKind,
      maxTokens: 32,
    });
    return requestedModel;
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
}

describe("DeepSeek V4 Flash 0731 canonicalization", () => {
  it("1. canonical 0731 outbound stays 0731", async () => {
    assert.equal(
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    );
    assert.equal(
      normalizeDeepSeekV4FlashModelId("deepseek-v4-flash-0731"),
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      adaptCheaperInferenceChatBody({
        model: "deepseek-v4-flash-0731",
        messages: [{ role: "user", content: "hello" }],
      }).model,
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      await captureOutboundModel({ model: "deepseek-v4-flash-0731" }),
      "deepseek-v4-flash-0731"
    );
  });

  it("2. legacy deepseek-v4-flash outbound becomes 0731", async () => {
    assert.equal(
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
      "deepseek-v4-flash"
    );
    assert.equal(
      normalizeDeepSeekV4FlashModelId("deepseek-v4-flash"),
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      adaptCheaperInferenceChatBody({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hello" }],
      }).model,
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      await captureOutboundModel({ model: "deepseek-v4-flash" }),
      "deepseek-v4-flash-0731"
    );
  });

  it("3. stored DB selectedAI deepseek-v4-flash stays valid and outbounds 0731", async () => {
    assert.equal(isValidSelectedAI("deepseek-v4-flash"), true);
    assert.equal(isCheaperInferenceDeepSeekV4FlashModel("deepseek-v4-flash"), true);
    assert.equal(resolveSelectedAI("deepseek-v4-flash"), "deepseek-v4-flash-0731");
    assert.equal(selectedAILabel("deepseek-v4-flash"), "DeepSeek V4 Flash");

    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        selected_ai TEXT NOT NULL DEFAULT '',
        ai_model_ux_json TEXT NOT NULL DEFAULT ''
      );
    `);
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      "deepseek-v4-flash"
    );
    const ensured = ensureUserSelectedAI(db, 1);
    assert.equal(ensured.selectedAI, "deepseek-v4-flash-0731");
    assert.equal(ensured.remappedFromRetired, false);
    db.close();

    assert.equal(
      await captureOutboundModel({ model: "deepseek-v4-flash" }),
      "deepseek-v4-flash-0731"
    );
  });

  it("4. new UI DeepSeek V4 Flash selection is canonical 0731", () => {
    const option = SELECTED_AI_OPTIONS.find(
      (entry) => entry.label === "DeepSeek V4 Flash"
    );
    assert.ok(option);
    assert.equal(option.id, "deepseek-v4-flash-0731");
    assert.equal(option.label, "DeepSeek V4 Flash");
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((entry) => entry.id === option.id),
      false
    );
    assert.equal(isValidSelectedAI("deepseek-v4-flash-0731"), true);
    assert.equal(
      resolveSelectedAI("deepseek-v4-flash-0731"),
      "deepseek-v4-flash-0731"
    );
  });

  it("5. background memory Flash call outbounds 0731", async () => {
    assert.equal(BACKGROUND_OPENROUTER_MODEL, "deepseek-v4-flash-0731");
    assert.equal(resolveBackgroundTextModelId(undefined), "deepseek-v4-flash-0731");
    assert.equal(
      resolveBackgroundTextModelId("deepseek-v4-flash"),
      "deepseek-v4-flash-0731"
    );

    const previousFetch = globalThis.fetch;
    const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    let requestedModel: string | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestedModel = (JSON.parse(String(init?.body)) as { model?: string }).model;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "요약" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      await callBackgroundMemory(
        "system",
        [{ role: "user", content: "기억" }],
        undefined,
        "background-memory-extract"
      );
      assert.equal(requestedModel, "deepseek-v4-flash-0731");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
    }
  });

  it("6. background status Flash call resolves to 0731", () => {
    assert.equal(BACKGROUND_OPENROUTER_MODEL, "deepseek-v4-flash-0731");
    assert.equal(
      statusWidgetExtractModelLabel("deepseek-v4-flash-0731"),
      "DeepSeek V4 Flash (상태창 추출)"
    );
    assert.equal(
      statusWidgetExtractModelLabel("deepseek-v4-flash"),
      "DeepSeek V4 Flash (상태창 추출)"
    );
  });

  it("7. HTML/background Flash call outbounds 0731", async () => {
    assert.equal(
      computeHtmlFlashOnlyTurnBilling({
        savedTextChars: 100,
        inputTokens: 100,
        outputTokens: 20,
      }).modelId,
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      await captureOutboundModel({
        model: BACKGROUND_OPENROUTER_MODEL,
        requestKind: "background-html-visual-card",
      }),
      "deepseek-v4-flash-0731"
    );
  });

  it("8. character-save KO→EN translation uses 0731", () => {
    assert.equal(DEFAULT_TRANSLATION_PRIMARY_MODEL, "deepseek-v4-flash-0731");
    const prevPrimary = process.env.PROMPT_TRANSLATION_MODEL;
    const prevFallback = process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
    delete process.env.PROMPT_TRANSLATION_MODEL;
    delete process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
    try {
      assert.equal(resolveTranslationModels()[0], "deepseek-v4-flash-0731");
    } finally {
      if (prevPrimary === undefined) delete process.env.PROMPT_TRANSLATION_MODEL;
      else process.env.PROMPT_TRANSLATION_MODEL = prevPrimary;
      if (prevFallback === undefined) delete process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
      else process.env.PROMPT_TRANSLATION_FALLBACK_MODELS = prevFallback;
    }
  });

  it("9. deprecated V3 Flash-role resolve outbounds 0731", async () => {
    assert.equal(
      resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
      "deepseek-v4-flash-0731"
    );
    assert.equal(
      await captureOutboundModel({
        model: resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
      }),
      "deepseek-v4-flash-0731"
    );
  });

  it("10. canonical 0731 pricing/point lookup matches the current Flash policy", () => {
    const rates = resolveOpenRouterModelRates("deepseek-v4-flash-0731");
    assert.equal(rates.inputUsdPerM, 0.098);
    assert.equal(rates.cacheReadUsdPerM, 0.0196);
    assert.equal(rates.cacheWriteUsdPerM, 0.098);
    assert.equal(rates.outputUsdPerM, 0.196);
    const points = resolveOpenRouterReasoningPointRates(
      "deepseek-v4-flash-0731",
      1530
    );
    assert.ok(points);
    assert.equal(points.grossMargin, 0.68);
    assert.equal(points.inputUsdPerMillion, 0.098);
    assert.equal(points.outputUsdPerMillion, 0.196);
  });

  it("11. legacy deepseek-v4-flash historical receipt compatibility stays intact", () => {
    assert.equal(isCheaperInferenceDeepSeekV4FlashModel("deepseek-v4-flash"), true);
    assert.equal(isCheaperInferenceModel("deepseek-v4-flash"), true);
    const legacyRates = resolveOpenRouterModelRates("deepseek-v4-flash");
    const canonicalRates = resolveOpenRouterModelRates("deepseek-v4-flash-0731");
    assert.equal(legacyRates.inputUsdPerM, canonicalRates.inputUsdPerM);
    assert.equal(legacyRates.outputUsdPerM, canonicalRates.outputUsdPerM);
    const usd = estimateApiCostUsd({
      model: "deepseek-v4-flash",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 200_000,
    });
    const expected = 0.8 * 0.098 + 0.2 * 0.0196 + 0.196;
    assert.ok(Math.abs(usd - expected) < 1e-12);
    assert.equal(
      statusWidgetExtractModelLabel("deepseek-v4-flash"),
      "DeepSeek V4 Flash (상태창 추출)"
    );
  });

  it("12. DeepSeek V4 Pro outbound remains 0813", () => {
    assert.equal(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "deepseek-v4-pro-0813");
    assert.equal(
      adaptCheaperInferenceChatBody({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "hello" }],
      }).model,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      adaptCheaperInferenceChatBody({
        model: "deepseek-v4-pro-0813",
        messages: [{ role: "user", content: "hello" }],
      }).model,
      "deepseek-v4-pro-0813"
    );
    assert.notEqual(
      normalizeDeepSeekV4FlashModelId("deepseek-v4-pro-0813"),
      "deepseek-v4-flash-0731"
    );
  });

  it("13. adult refusal fallback remains DeepSeek V4 Pro 0813", () => {
    assert.equal(
      ADULT_SCENE_MODEL_POLICY.primaryModelId,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      resolveAdultRoutingConfig({}).adultModelId,
      "deepseek-v4-pro-0813"
    );
    assert.equal(
      resolveAdultRoutingConfig({ ADULT_MODEL_ID: "deepseek-v4-pro" }).adultModelId,
      "deepseek-v4-pro-0813"
    );
    assert.notEqual(
      resolveAdultRoutingConfig({}).adultModelId,
      "deepseek-v4-flash-0731"
    );
    assert.notEqual(
      resolveAdultRoutingConfig({}).adultModelId,
      "deepseek-v4-flash"
    );
  });
});
