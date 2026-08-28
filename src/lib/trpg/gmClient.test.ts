import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "../cheaperInferenceConfig";
import {
  adaptTrpgBotChatBody,
  adaptTrpgGmChatBody,
  isTrpgGeminiLowReasoningRequest,
  isTrpgTrueOffRequest,
  trpgProviderRequestContract,
} from "./gmClient";
import { reasoningTokensFromProviderUsage } from "./gmCall";
import { TRPG_BOT_MODEL, TRPG_GM_MAX_TOKENS, TRPG_GM_MODEL } from "./types";

function thinkingType(body: Record<string, unknown>): string {
  const thinking = body.thinking;
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)) return "";
  return String((thinking as { type?: unknown }).type ?? "");
}

describe("TRPG GM call path vs regular chat", () => {
  it("sends DeepSeek legacy true OFF as thinking.disabled + reasoning_effort.none", () => {
    const body = {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    };
    const gm = adaptTrpgGmChatBody(body);
    const bot = adaptTrpgBotChatBody(body);
    assert.deepEqual(gm, {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    });
    assert.deepEqual(bot, {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    });
    assert.deepEqual(adaptCheaperInferenceChatBody(body), {
      model: "deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "장면" }],
      thinking: { type: "disabled" },
    });
    assert.equal(body.reasoning_effort, "high", "input must not be mutated");
  });

  it("keeps a high max_tokens cap on the GM adapter", () => {
    const withCap = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      max_tokens: TRPG_GM_MAX_TOKENS,
    });
    assert.equal(withCap.max_tokens, TRPG_GM_MAX_TOKENS);
    assert.equal(withCap.reasoning_effort, "low");
    assert.equal(withCap.thinking, undefined);
  });
});

describe("TRPG production model request contracts", () => {
  it("pins Bot Luna and GM Gemini adapter fields", () => {
    const gm = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
      stream: true,
    });
    const bot = adaptTrpgBotChatBody({
      model: TRPG_BOT_MODEL,
      messages: [{ role: "user", content: "문을 막는다" }],
      reasoning_effort: "high",
      stream: false,
    });
    assert.equal(gm.model, TRPG_GM_MODEL);
    assert.equal(gm.reasoning_effort, "low");
    assert.equal(gm.thinking, undefined);
    assert.equal(bot.model, TRPG_BOT_MODEL);
    assert.deepEqual(bot.reasoning, { effort: "none" });
    assert.equal(bot.reasoning_effort, "none");
    assert.equal(bot.thinking, undefined);
  });

  it("keeps stream=true on GM transport with Gemini low reasoning contract", () => {
    const gm = adaptTrpgGmChatBody({
      model: TRPG_GM_MODEL,
      messages: [{ role: "user", content: "장면" }],
      stream: true,
      temperature: 0.7,
    });
    const contract = trpgProviderRequestContract(gm);
    assert.equal(contract.model, TRPG_GM_MODEL);
    assert.equal(contract.thinkingType, "");
    assert.equal(contract.reasoningEffort, "low");
    assert.equal(contract.stream, true);
    assert.equal(isTrpgGeminiLowReasoningRequest(contract), true);
    assert.equal(isTrpgTrueOffRequest(contract), false);
    assert.equal(gm.stream, true);
  });

  it("does not invent reasoning tokens when the provider omits them", () => {
    assert.equal(reasoningTokensFromProviderUsage(undefined), "unavailable");
    assert.equal(reasoningTokensFromProviderUsage({}), "unavailable");
    assert.equal(reasoningTokensFromProviderUsage({ completion_tokens_details: {} }), "unavailable");
    assert.equal(
      reasoningTokensFromProviderUsage({ completion_tokens_details: { reasoning_tokens: 12 } }),
      12
    );
  });
});

describe("TRPG DeepSeek legacy true-OFF contract", () => {
  it("still pins DeepSeek explicit paths to thinking.disabled + reasoning_effort.none", () => {
    const gm = adaptTrpgGmChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "장면" }],
      reasoning_effort: "high",
    });
    const bot = adaptTrpgBotChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "문을 막는다" }],
      reasoning_effort: "high",
    });
    assert.equal(thinkingType(gm), "disabled");
    assert.equal(gm.reasoning_effort, "none");
    assert.equal(thinkingType(bot), "disabled");
    assert.equal(bot.reasoning_effort, "none");
    assert.equal(gm.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(bot.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });
});
