import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  adaptCheaperInferenceChatBody,
  applyDeepSeekAdultHandoffTrueOff,
  resolveDeepSeekAdultHandoffTrueOff,
} from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "./chatModels";
import { assemblePrimaryRpRequest } from "./openRouterAdult";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

function hashMessages(messages: Array<{ role: string; content: unknown }>): string {
  return sha256(
    messages.map((m) => `${m.role}\u0000${flattenContent(m.content)}`).join("\u0001")
  );
}

function transportKeys(body: Record<string, unknown>) {
  return {
    thinking: body.thinking ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    reasoning: body.reasoning ?? null,
    include_reasoning: body.include_reasoning ?? null,
    enable_thinking: body.enable_thinking ?? null,
  };
}

const FROZEN_SYSTEM = "COMMON SYSTEM — transport parity fixture";
const FROZEN_HISTORY = [
  { role: "assistant" as const, content: "인사한다." },
  { role: "user" as const, content: "지금 이 거리에서 입 맞춰도 되지?" },
];

describe("DeepSeek0813 adult-handoff TRUE-OFF P2", () => {
  it("A — non-DeepSeek source + adult handoff + DeepSeek0813 sends TRUE-OFF", () => {
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        adultHandoffActuallyApplied: true,
        resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      true
    );
    const body = adaptCheaperInferenceChatBody(
      {
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        messages: [{ role: "user", content: "hello" }],
        reasoning_effort: "high",
        reasoning: { effort: "high" },
        include_reasoning: true,
        enable_thinking: true,
      },
      { deepSeekAdultHandoffTrueOff: true }
    );
    assert.equal(body.model, "deepseek-v4-pro-0813");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "none");
    assert.equal(body.reasoning, undefined);
    assert.equal(body.include_reasoning, undefined);
    assert.equal(body.enable_thinking, undefined);
  });

  it("B — native DeepSeek is not an adult-handoff TRUE-OFF mutation", () => {
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        adultHandoffActuallyApplied: false,
        resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      false
    );
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        adultHandoffActuallyApplied: true,
        resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      false
    );
    const native = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    const nativeWithUnusedFlagOff = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    assert.deepEqual(native, nativeWithUnusedFlagOff);
    assert.deepEqual(native.thinking, { type: "disabled" });
    assert.equal(native.reasoning_effort, undefined);
    assert.equal("reasoning_effort" in native, false);
  });

  it("C — Gemini normal RP stays Gemini and does not receive DeepSeek TRUE-OFF", () => {
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        adultHandoffActuallyApplied: false,
        resolvedTargetModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      }),
      false
    );
    const gemini37 = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      messages: [{ role: "user", content: "hello" }],
    });
    const gemini31 = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(gemini37.model, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(gemini37.reasoning_effort, "low");
    assert.equal(gemini37.thinking, undefined);
    assert.equal(gemini31.model, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.equal(gemini31.reasoning_effort, "low");
    assert.equal(gemini31.thinking, undefined);
  });

  it("D — non-DeepSeek adult eligibility false does not apply DeepSeek handoff transport", () => {
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        adultHandoffActuallyApplied: false,
        resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      false
    );
    assert.equal(
      resolveDeepSeekAdultHandoffTrueOff({
        selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        adultHandoffActuallyApplied: true,
        resolvedTargetModelId: "qwen-3-8-max",
      }),
      false
    );
  });

  it("E — frozen adult-handoff messages SHA is identical; only reasoning_effort is added", () => {
    const before = assemblePrimaryRpRequest({
      system: FROZEN_SYSTEM,
      history: FROZEN_HISTORY,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stream: true,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: "플러드",
      },
    });
    const after = assemblePrimaryRpRequest({
      system: FROZEN_SYSTEM,
      history: FROZEN_HISTORY,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stream: true,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName: "플러드",
        deepSeekAdultHandoffTrueOff: true,
      },
    });
    assert.equal(hashMessages(before.messages), hashMessages(after.messages));
    assert.deepEqual(before.requestBody.messages, after.requestBody.messages);
    const beforeKeys = Object.keys(before.requestBody).sort();
    const afterKeys = Object.keys(after.requestBody).sort();
    assert.deepEqual(
      beforeKeys.filter((k) => k !== "reasoning_effort"),
      afterKeys.filter((k) => k !== "reasoning_effort")
    );
    assert.equal(before.requestBody.reasoning_effort, undefined);
    assert.equal(after.requestBody.reasoning_effort, "none");
    for (const key of beforeKeys) {
      if (key === "reasoning_effort") continue;
      assert.deepEqual(before.requestBody[key], after.requestBody[key], key);
    }
    assert.deepEqual(transportKeys(after.requestBody), {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      reasoning: null,
      include_reasoning: null,
      enable_thinking: null,
    });
    const reapplied = applyDeepSeekAdultHandoffTrueOff(before.requestBody);
    assert.equal(reapplied.reasoning_effort, "none");
    assert.deepEqual(reapplied.messages, before.requestBody.messages);
  });
});
