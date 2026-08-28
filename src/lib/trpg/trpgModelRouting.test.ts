import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
} from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "../cheaperInferenceConfig";
import {
  adaptTrpgBotChatBody,
  adaptTrpgGmChatBody,
  isTrpgGeminiLowReasoningRequest,
  isTrpgTrueOffRequest,
  trpgProviderRequestContract,
} from "./gmClient";
import { resolveTrpgCheaperInferenceModel } from "./gmCall";
import { TRPG_BOT_MODEL, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";

function thinkingType(body: Record<string, unknown>): string {
  const thinking = body.thinking;
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)) return "";
  return String((thinking as { type?: unknown }).type ?? "");
}

describe("TRPG production model routing (PR-A)", () => {
  it("pins Bot=Luna and GM=Gemini 3.7 Flash", () => {
    assert.equal(TRPG_BOT_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.equal(TRPG_GM_MODEL, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  });

  it("adaptTrpgBotChatBody sends Luna true-off without DeepSeek thinking pollution", () => {
    const bot = adaptTrpgBotChatBody({
      model: TRPG_BOT_MODEL,
      messages: [{ role: "user", content: "행동" }],
      stream: false,
      temperature: 0.85,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      reasoning_effort: "high",
    });
    assert.equal(bot.model, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.equal(bot.stream, false);
    assert.deepEqual(bot.reasoning, { effort: "none" });
    assert.equal(bot.reasoning_effort, "none");
    assert.equal(bot.thinking, undefined);
    const contract = trpgProviderRequestContract(bot);
    assert.equal(isTrpgTrueOffRequest(contract), true);
  });

  it("adaptTrpgGmChatBody sends Gemini low reasoning without forced none", () => {
    const gm = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      messages: [{ role: "user", content: "장면" }],
      stream: true,
      temperature: 0.7,
      max_tokens: TRPG_GM_MAX_TOKENS,
      reasoning_effort: "none",
      thinking: { type: "disabled" },
    });
    assert.equal(gm.model, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(gm.stream, true);
    assert.equal(gm.reasoning_effort, "low");
    assert.equal(gm.thinking, undefined);
    assert.equal(gm.reasoning, undefined);
    const contract = trpgProviderRequestContract(gm);
    assert.equal(isTrpgGeminiLowReasoningRequest(contract), true);
    assert.equal(isTrpgTrueOffRequest(contract), false);
  });

  it("resolveTrpgCheaperInferenceModel preserves configured models without DeepSeek fallback", () => {
    assert.equal(resolveTrpgCheaperInferenceModel(TRPG_BOT_MODEL), CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.equal(resolveTrpgCheaperInferenceModel(TRPG_GM_MODEL), CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.throws(
      () => resolveTrpgCheaperInferenceModel("unknown-model"),
      /unsupported Cheaper Inference model/
    );
    assert.throws(
      () => resolveTrpgCheaperInferenceModel("openrouter/auto"),
      /unsupported Cheaper Inference model/
    );
  });

  it("preserves DeepSeek legacy true-off when explicitly passed to TRPG adapters", () => {
    const body = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    };
    const gm = adaptTrpgGmChatBody(body);
    const bot = adaptTrpgBotChatBody(body);
    assert.equal(gm.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(bot.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(thinkingType(gm), "disabled");
    assert.equal(gm.reasoning_effort, "none");
    assert.equal(thinkingType(bot), "disabled");
    assert.equal(bot.reasoning_effort, "none");
    assert.deepEqual(adaptCheaperInferenceChatBody(body), {
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
    });
  });
});
